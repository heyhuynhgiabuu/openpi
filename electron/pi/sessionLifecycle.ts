/**
 * Session lifecycle for the sidecar: disposing the active session and
 * creating (or resuming, or forking) a new one. Owns the state transitions
 * in sidecarContext; command modules only call startSession/stopSession.
 */

import type { SessionReadyPayload } from './sidecarTypes'
import { createAgentSession, SessionManager } from '@earendil-works/pi-coding-agent'
import { createOpenPiExtensionUIContext } from './extensionUiContext'
import { rejectAllExtensionUiPending } from './extensionUiPending'
import { forwardSessionEvents } from './eventBridge'
import { createSessionSettingsManager } from './sessionSettings'
import { chooseSessionRuntime, decideCutover, type DurableCapability } from './cutover'
import { durableSessions } from './durableHost'
import { isStaleExtensionCtxMessage } from './staleCtx'
import {
  clearResourceLoaderCache,
  getAgentDir,
  getModelRuntime,
  getResourceLoader,
  outputLine,
  send,
  setState,
  getState,
} from './sidecarContext'

/**
 * Capabilities this build has wired for the durable runtime. The command set is written and tested,
 * but four things reachable only through it are still open, so the gate stays shut:
 *
 * - replacing a durable session does not abort its run, and pi-durable keeps the abandoned prompt
 *   pending in the store, so the next message re-runs it (reload works around this; `start_session`
 *   does not);
 * - a durable start or resume that fails after the SDK session was disposed leaves the sidecar
 *   without a session, while main restores the old one and goes on sending prompts into nothing;
 * - `get_default_project_trust` / `set_default_project_trust` / `list_slash_commands` read the SDK
 *   state, which is null on a durable session (the trust toggle goes nowhere, the slash menu is
 *   empty);
 * - a prompt starting with `/` is refused on the durable side, so prompt templates, skills and
 *   extension commands are unavailable even though customizations are supposed to work.
 *
 * Add `sessionCommands` here when those are closed and a real session has been driven through the
 * renderer. Nothing in the suite fails when the gate opens (checked: flipping it leaves every test
 * green), so opening it is a deliberate change, not something a green build will tell you.
 */
const WIRED_DURABLE_CAPABILITIES: readonly DurableCapability[] = [
  'adapter',
  'customizations',
  'policy',
  'mcp',
  'sessionIndex',
  'eventBridge',
  'sessionFiles',
]
const DURABLE_ADAPTER_AVAILABLE = true
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
  try {
    await teardownSession(session, () => emitSessionShutdown(session, reason))
  } finally {
    // `session.dispose()` invalidates the extension runtime of the resource loader the
    // session was built from, and Pi never revives an invalidated runtime. Every
    // extension's captured `pi` then throws "This extension ctx is stale ...". A loader
    // kept for the next session would hand that runtime to it, and Pi's built-in MCP
    // extension (its `tool_call` handler calls `pi.getAllTools()`) would block every tool
    // call of that session. Pi's own session replacement builds a fresh loader each time
    // (createAgentSessionServices); do the same here.
    clearResourceLoaderCache()
  }
}

async function stopSdkSession(reason: 'new' | 'resume' | 'fork'): Promise<void> {
  const previous = getState()
  if (!previous) return
  setState(null)
  previous.unsubscribe()
  await stopSession(previous.session, reason)
}

export async function startSession(
  cwd: string,
  opts: {
    sessionFile?: string
    forkEntryId?: string
    requestId?: string
    workspaceTrusted?: boolean
    /** Stored runtime preference from Electron main; the cutover gate decides what actually runs. */
    runtimePreference?: string
  } = {}
): Promise<void> {
  // A durable session from a previous start must not outlive this one.
  await durableSessions.stop()

  // Cutover gate: the durable runtime may only serve a session when every capability it needs is
  // wired; forking a session stays on the SDK path.
  const decision = decideCutover({
    stored: opts.runtimePreference,
    durableAvailable: DURABLE_ADAPTER_AVAILABLE,
    capabilities: WIRED_DURABLE_CAPABILITIES,
  })
  const choice = chooseSessionRuntime(decision, opts)
  const reason = decision.reason ?? choice.reason
  if (reason) outputLine('warn', `[runtime] staying on the Pi SDK path: ${reason}`)
  const trusted = opts.workspaceTrusted ?? false
  // A resumed file is only reopened when this runtime wrote it and the file is still the one it
  // wrote; anything else is read by the SDK path below, as before. Reading it here rather than
  // after the teardown keeps the two reads and the disposal in one readable order, and means a
  // declined file never reaches the durable start at all.
  const resumable =
    choice.runtime === 'durable' && choice.start === 'resume' && opts.sessionFile
      ? await durableSessions.canResume(opts.sessionFile)
      : false
  if (choice.runtime === 'durable' && (choice.start === 'new' || resumable)) {
    await stopSdkSession(choice.start)
    if (opts.sessionFile && choice.start === 'resume') {
      // `canResume` said yes, but the file can change between the two reads. The sidecar is left
      // without a session either way (see `WIRED_DURABLE_CAPABILITIES`); at least answer the open
      // request instead of leaving main to time out against a session that will never exist.
      const resumed = await durableSessions.resumeFrom(
        cwd,
        opts.sessionFile,
        trusted,
        opts.requestId
      )
      if (!resumed) {
        throw new Error(
          `${opts.sessionFile} changed while it was being opened; open it again to continue`
        )
      }
      return
    }
    await durableSessions.start(cwd, { workspaceTrusted: trusted, requestId: opts.requestId })
    return
  }
  if (choice.runtime === 'durable' && choice.start === 'resume' && opts.sessionFile)
    outputLine('warn', `[runtime] ${opts.sessionFile} is not a session this runtime can reopen`)

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
  await stopSdkSession(opts.forkEntryId ? 'fork' : opts.sessionFile ? 'resume' : 'new')

  const agentDir = getAgentDir()
  const modelRuntime = await getModelRuntime()
  const workspaceTrusted = opts.workspaceTrusted ?? false
  // `projectTrusted` here is what extensions see as `ctx.isProjectTrusted()`; the
  // built-in MCP extension gates `<cwd>/.pi/mcp.json` on it (see sessionSettings.ts).
  const settingsManager = createSessionSettingsManager(cwd, agentDir, workspaceTrusted)
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
