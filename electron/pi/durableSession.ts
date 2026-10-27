import type { DurableHarness } from './durable/types'
import type { SessionReadyPayload, SidecarCommand, SidecarMessage } from './sidecarTypes'

/**
 * Phase 8.3f: a durable-runtime session behind the sidecar's command protocol.
 *
 * The SDK path keeps its own `SessionState` untouched; this is a second, separate slot. Commands
 * are routed here first (`handleCommand`): while a durable session is active it serves the ones it
 * can, refuses the session-bound ones it cannot with an explicit error (never a silent no-op), and
 * hands everything else — models, settings, providers, `start_session`, `stop` — back to the
 * existing handlers by returning `false`.
 *
 * This factory takes its collaborators as parameters instead of importing the sidecar context, so
 * it is testable with a real harness and no parent process.
 */

export interface DurableIdentity {
  sessionId: string
  /** Where the JSONL v3 export lives; the sidebar reads it like any other session. */
  sessionFile: string
}

export interface DurableOpenResult {
  harness: DurableHarness
  model: SessionReadyPayload['model']
}

export interface DurableSessionDeps {
  send: (message: SidecarMessage) => void
  log: (level: 'info' | 'warn' | 'error', text: string) => void
  newIdentity: (cwd: string) => DurableIdentity
  open: (
    cwd: string,
    workspaceTrusted: boolean,
    identity: DurableIdentity
  ) => Promise<DurableOpenResult>
  now: () => Date
}

export interface DurableStartOptions {
  workspaceTrusted: boolean
  requestId?: string
}

interface ActiveSession {
  harness: DurableHarness
  cwd: string
  identity: DurableIdentity
  startedAt: string
  stopEvents: () => Promise<void>
}

/** Commands that act on the live session and have no durable implementation yet. */
const UNSUPPORTED_SESSION_COMMANDS = [
  'steer',
  'follow_up',
  'abort',
  'execute_bash',
  'set_model',
  'set_thinking',
  'set_session_name',
  'get_session_info',
  'compact',
  'reload_session',
  'copy_last_assistant_text',
  'fork_session',
  'navigate_tree',
  'get_stats',
] as const satisfies readonly SidecarCommand['type'][]

function isUnsupported(type: SidecarCommand['type']): boolean {
  return (UNSUPPORTED_SESSION_COMMANDS as readonly string[]).includes(type)
}

export interface DurableSessions {
  isActive(): boolean
  start(cwd: string, options: DurableStartOptions): Promise<void>
  /** `true` when the command was fully handled here; `false` to fall through to the SDK handlers. */
  handleCommand(cmd: SidecarCommand): Promise<boolean>
  stop(): Promise<void>
}

export function createDurableSessions(deps: DurableSessionDeps): DurableSessions {
  let active: ActiveSession | null = null

  async function exportNow(session: ActiveSession): Promise<void> {
    try {
      await session.harness.exportSession(session.identity.sessionFile, {
        sessionId: session.identity.sessionId,
        cwd: session.cwd,
        startedAt: session.startedAt,
      })
      deps.send({ type: 'session_index_updated' })
    } catch (error) {
      deps.log('error', `[durable] session export failed: ${errorText(error)}`)
    }
  }

  async function stop(): Promise<void> {
    const session = active
    active = null
    if (!session) return
    try {
      await session.stopEvents()
      await session.harness.close()
    } catch (error) {
      deps.log('warn', `[durable] shutdown: ${errorText(error)}`)
    }
  }

  async function start(cwd: string, options: DurableStartOptions): Promise<void> {
    await stop()
    const identity = deps.newIdentity(cwd)
    const { harness, model } = await deps.open(cwd, options.workspaceTrusted, identity)
    const session: ActiveSession = {
      harness,
      cwd,
      identity,
      startedAt: deps.now().toISOString(),
      stopEvents: async () => undefined,
    }
    active = session
    deps.send({
      type: 'session_ready',
      requestId: options.requestId,
      payload: {
        cwd,
        sessionFile: identity.sessionFile,
        sessionId: identity.sessionId,
        sessionName: null,
        model,
        thinkingLevel: null,
      },
    })
    // After `session_ready`: the renderer resets conversation state on ready, so the snapshot the
    // event feed opens with would be discarded if it arrived first.
    try {
      session.stopEvents = await harness.watchEvents((event) => {
        deps.send({ type: 'session_event', event })
      })
    } catch (error) {
      await stop()
      throw error
    }
  }

  async function prompt(cmd: Extract<SidecarCommand, { type: 'prompt' }>): Promise<void> {
    const session = active
    if (!session) return
    const text = cmd.text.trim()
    if (text.startsWith('/')) {
      throw new Error('slash commands are not supported on the durable runtime yet')
    }
    const prefix = cmd.contextPrefix?.trim()
    const result = await session.harness.prompt(prefix ? `${prefix}\n\n${text}` : text)
    if (result.status === 'unanswered') {
      deps.log(
        'warn',
        `[durable] run ended without an answer${result.reason ? `: ${result.reason}` : ''}`
      )
    }
    await exportNow(session)
  }

  async function handleCommand(cmd: SidecarCommand): Promise<boolean> {
    if (!active) return false
    if (cmd.type === 'prompt') {
      await prompt(cmd)
      return true
    }
    if (cmd.type === 'stop') {
      await stop()
      return false
    }
    if (isUnsupported(cmd.type)) {
      throw new Error(`'${cmd.type}' is not supported on the durable runtime yet`)
    }
    return false
  }

  return { isActive: () => active !== null, start, handleCommand, stop }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
