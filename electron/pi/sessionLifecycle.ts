/**
 * Session lifecycle for the sidecar: disposing the active session and
 * creating (or resuming, or forking) a new one. Owns the state transitions
 * in sidecarContext; command modules only call startSession/stopSession.
 */

import type { SessionReadyPayload } from './sidecarTypes'
import { createAgentSession, SessionManager } from '@earendil-works/pi-coding-agent'
import { rejectAllExtensionUiPending } from './extensionUiPending'
import { forwardSessionEvents } from './eventBridge'
import { bindSessionExtensions } from './sessionExtensions'
import { createSessionSettingsManager } from './sessionSettings'
import { chooseSessionRuntime, decideCutover, type DurableCapability } from './cutover'
import { durableSessions } from './durableHost'
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
 * Capabilities this build has wired for the durable runtime.
 *
 * Every blocker that kept `sessionCommands` out is closed, and the fixes are tested:
 *
 * - replacing a durable session aborts its run before closing the harness (`durableSession.stop`),
 *   so pi-durable does not leave the abandoned prompt pending for the next message to re-run;
 * - a start that fails after the previous session was disposed puts that session back
 *   (`sessionDurableStart.ts`), including a durable one — read before the teardown, and reopened
 *   with its own workspace and trust rather than the failed request's;
 * - the trust commands and `list_slash_commands` take the workspace from whichever runtime is
 *   serving, and a `/`-prompt expands through the harness (an unanswered one is reported in the
 *   transcript, as the SDK reports it) instead of being refused or sent as literal text.
 *
 * The gate is OPEN: an opted-in session runs on this runtime. The two conditions that blocked opening
 * are done and tested — a failed harness open releases what it started (`durable/release.ts`,
 * `connectServer` closing its client when a tool listing fails), and a restart during a run resumes
 * the in-flight prompt (a reopen waits for idle, which also enables scheduling, then exports).
 *
 * Two e2e specs are the witnesses, and both must be run by hand with `OPENPI_E2E_DURABLE=1`:
 * `durableGate.spec.ts` drives a real session through the renderer (a shell turn, so no model), and
 * `durablePrompt.spec.ts` drives a prompt turn through a real model and asserts its answer on screen
 * and in the exported tree. Those drives are what found the model-choice and no-default-model defects;
 * keeping them is why opening the gate was worth delaying.
 *
 * This does NOT flip the default: the runtime still needs the preference set to `durable`, and
 * anything without one keeps running on the SDK path. Flipping needs the remaining ROADMAP Phase 8
 * conditions — items 6 and 7 must be resolved or explicitly accepted, item 8 (CI running those
 * specs automatically, because a green CI currently says nothing about them), and the rest of
 * item 9: the pre-apply review gate is still missing. Extension-provided model providers are now
 * loaded (`durable/providers.ts`, global extensions only), which is why that capability is listed.
 * This runtime still loads no project extensions and no tool_call hooks.
 */
export const WIRED_DURABLE_CAPABILITIES: readonly DurableCapability[] = [
  'adapter',
  'customizations',
  'policy',
  'mcp',
  'sessionIndex',
  'eventBridge',
  'sessionFiles',
  'sessionCommands',
  'extensionProviders',
]
const DURABLE_ADAPTER_AVAILABLE = true
import { startDurable } from './sessionDurableStart'
import {
  prepareFork,
  previousSession,
  restoreSession,
  type PreviousSession,
} from './sessionRestore'
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

/**
 * The session running now, in the shape a restore needs — read before the teardown: a durable
 * session lives only in the durable factory, so asking after `stop()` finds nothing and a failed
 * replacement would leave the sidecar empty while main still shows the old session.
 */
function restoreCandidate(cwd: string, opts: StartOptions): PreviousSession | undefined {
  if (opts.restoring) return undefined
  return previousSession({
    // A durable session is reopened in the workspace and with the trust it was serving, not the
    // ones this request named: that is where its conversations live, and trust decides whether
    // that workspace's MCP servers start.
    cwd: durableSessions.cwd() ?? cwd,
    runtimePreference: opts.runtimePreference,
    reopenable: () => durableSessions.reopenable(),
  })
}

interface StartOptions {
  sessionFile?: string
  forkEntryId?: string
  requestId?: string
  workspaceTrusted?: boolean
  /**
   * Set while putting back a session a failed replacement disposed. A restore that fails must not
   * try to restore again, or a broken workspace would recurse instead of reporting once.
   */
  restoring?: boolean
  /** Stored runtime preference from Electron main; the cutover gate decides what actually runs. */
  runtimePreference?: string
}

export async function startSession(cwd: string, opts: StartOptions = {}): Promise<void> {
  // What a failed replacement falls back to, captured before anything is stopped.
  const previous = restoreCandidate(cwd, opts)

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
  // wrote; anything else is read by the SDK path below, as before.
  const resumable =
    choice.runtime === 'durable' && choice.start === 'resume' && opts.sessionFile
      ? await durableSessions.canResume(opts.sessionFile)
      : false
  if (choice.runtime === 'durable' && (choice.start === 'new' || resumable)) {
    await startDurable({
      sessions: durableSessions,
      trusted,
      cwd,
      sessionFile: opts.sessionFile,
      requestId: opts.requestId,
      start: choice.start,
      previous,
      stopSdk: stopSdkSession,
      restore: (session) => restoreSession(session, startSession),
    })
    return
  }
  if (choice.runtime === 'durable' && choice.start === 'resume' && opts.sessionFile)
    outputLine('warn', `[runtime] ${opts.sessionFile} is not a session this runtime can reopen`)

  const preparedForkFile = prepareFork(opts, cwd)

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

  await bindSessionExtensions(session)

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
