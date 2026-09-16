/**
 * Session lifecycle for the sidecar: disposing the active session and
 * creating (or resuming, or forking) a new one. Owns the state transitions
 * in sidecarContext; command modules only call startSession/stopSession.
 */

import type { SessionReadyPayload } from './sidecarTypes'
import {
  createAgentSession,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import { createOpenPiExtensionUIContext } from './extensionUiContext'
import { rejectAllExtensionUiPending } from './extensionUiPending'
import { forwardSessionEvents } from './eventBridge'
import { isStaleExtensionCtxMessage } from './staleCtx'
import {
  getAgentDir,
  getModelRuntime,
  getResourceLoader,
  outputLine,
  send,
  setState,
  getState,
} from './sidecarContext'
import { teardownSession } from './sessionTeardown'

/**
 * Emit session_shutdown to extensions before disposing a session.
 * This lets extensions (e.g. pi-sub-bar) clean up timers and release
 * captured ctx references. Without this, timers fire with stale ctx
 * and crash the sidecar.
 */
async function emitSessionShutdown(
  session: Awaited<ReturnType<typeof createAgentSession>>['session'],
  reason: 'quit' | 'reload' | 'new' | 'resume' | 'fork'
): Promise<void> {
  try {
    // `session.extensionRunner` is a public typed getter in the Pi SDK.
    // `emit` iterates registered handlers; no-op when none are subscribed.
    await session.extensionRunner.emit({ type: 'session_shutdown', reason })
  } catch {
    // Never let extension errors block session disposal
  }
}

export async function stopSession(
  session: Awaited<ReturnType<typeof createAgentSession>>['session'],
  reason: 'quit' | 'reload' | 'new' | 'resume' | 'fork'
): Promise<void> {
  // Settle any blocking extension UI prompt first so its dialogPromise
  // .finally emits ui_prompt_end before the session event stream shuts down.
  rejectAllExtensionUiPending(`session ${reason}`)
  await teardownSession(session, () => emitSessionShutdown(session, reason))
}

export async function startSession(
  cwd: string,
  opts: {
    sessionFile?: string
    forkEntryId?: string
    requestId?: string
    workspaceTrusted?: boolean
  } = {}
): Promise<void> {
  // Validate fork identity before disposing the active session so malformed or
  // stale renderer entry IDs cannot leave the sidecar without a session.
  let preparedForkFile: string | undefined
  if (opts.sessionFile && opts.forkEntryId) {
    const preflightManager = SessionManager.open(opts.sessionFile, undefined, cwd)
    preparedForkFile = preflightManager.createBranchedSession(opts.forkEntryId) ?? undefined
    if (!preparedForkFile) throw new Error(`Cannot fork: entry not found (${opts.forkEntryId})`)
  }

  // Dispose previous session — emit session_shutdown first so extensions
  // (e.g. pi-task polling) clear timers and drop captured `pi` before ctx invalidates.
  const previous = getState()
  if (previous) {
    setState(null)
    previous.unsubscribe()
    const shutdownReason: 'new' | 'resume' | 'fork' = opts.forkEntryId
      ? 'fork'
      : opts.sessionFile
        ? 'resume'
        : 'new'
    await stopSession(previous.session, shutdownReason)
  }

  const agentDir = getAgentDir()
  const modelRuntime = await getModelRuntime()
  const fileSettingsManager = SettingsManager.create(cwd, agentDir)
  const workspaceTrusted = opts.workspaceTrusted ?? false
  const settingsManager = workspaceTrusted
    ? fileSettingsManager
    : SettingsManager.inMemory(fileSettingsManager.getGlobalSettings())
  const sessionManager = preparedForkFile
    ? SessionManager.open(preparedForkFile, undefined, cwd)
    : opts.sessionFile
      ? SessionManager.open(opts.sessionFile, undefined, cwd)
      : SessionManager.create(cwd)

  const resourceLoader = await getResourceLoader(cwd, workspaceTrusted)

  const { session } = await createAgentSession({
    cwd,
    agentDir,
    sessionManager,
    modelRuntime,
    settingsManager,
    resourceLoader,
  })

  const extensionUiSinks = {
    sessionEvent: (event: Record<string, unknown>) => {
      send({ type: 'session_event', event })
    },
    postExtensionUiRequest: (
      request: import('../../src/lib/extensionUiTypes').ExtensionUiRequest
    ) => {
      send({ type: 'extension_ui_request', request })
    },
  }

  try {
    await session.bindExtensions({
      uiContext: createOpenPiExtensionUIContext(extensionUiSinks),
      mode: 'rpc',
      commandContextActions: {
        waitForIdle: () => session.agent.waitForIdle(),
        newSession: async () => ({ cancelled: true }),
        fork: async () => ({ cancelled: true }),
        navigateTree: async () => ({ cancelled: true }),
        switchSession: async () => ({ cancelled: true }),
        reload: async () => {
          await session.reload()
        },
      },
      onError: (err) => {
        // Suppress the benign "stale extension ctx" errors from pi-task.
        // pi-task's background polling captures `pi` (ExtensionAPI); when
        // our reload path does a full session replacement, in-flight async
        // work briefly calls `pi.sendMessage` on the now-stale ctx. The
        // SDK throws messages starting with "This extension ctx is stale
        // after session replacement or reload..." which surface as noisy
        // extension_error events. They are harmless — the new session is
        // already running. Filter them so the user only sees real errors.
        const msg = err.error
        if (isStaleExtensionCtxMessage(msg)) return
        outputLine('error', `[extension] ${err.extensionPath} (${err.event}): ${msg}`)
      },
    })
  } catch (err) {
    outputLine(
      'error',
      `[openpi] bindExtensions failed: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  const unsubscribe = forwardSessionEvents(session, () => send({ type: 'session_index_updated' }))

  setState({ session, cwd, workspaceTrusted, unsubscribe })

  const model = session.model as
    | { id: string; name: string; provider: string; reasoning?: boolean; contextWindow?: number }
    | undefined

  const payload: SessionReadyPayload = {
    cwd,
    sessionFile: session.sessionFile ?? null,
    sessionId: session.sessionId ?? null,
    sessionName: opts.sessionFile ? null : null, // main process resolves display name from SQLite
    model: model
      ? {
          id: model.id,
          name: model.name,
          provider: model.provider,
          reasoning: model.reasoning ?? false,
          contextWindow: model.contextWindow ?? 0,
        }
      : null,
    thinkingLevel: (session.thinkingLevel as string | undefined) ?? null,
  }

  send({ type: 'session_ready', requestId: opts.requestId, payload })

  // The SDK does not emit events for extension load failures — it collects
  // them on the resource loader (pi's CLI prints them itself). Without this,
  // a broken extension (throwing factory, wrong export) or a resource
  // conflict (same tool/command name from two extensions) silently vanishes:
  // the session starts and nothing explains the missing tools, commands, or
  // providers. Sent AFTER session_ready: the renderer resets conversation
  // state on ready, so anything sent earlier would be discarded.
  for (const loadError of resourceLoader.getExtensions().errors) {
    outputLine('error', `[extension] ${loadError.path} (load): ${loadError.error}`)
    send({
      type: 'session_event',
      event: {
        type: 'extension_error',
        extensionPath: loadError.path,
        event: 'load',
        error: loadError.error,
      },
    })
  }
}
