import type { DurableHarness } from './durable/types'
import { answerInfoCommand, isInfoCommand, type InfoSource } from './durableInfo'
import {
  applySettingsCommand,
  isSettingsCommand,
  type SettingsDeps,
  type SettingsPersist,
} from './durableSettings'
import { runCompact } from './durableCompact'
import type { ModelThinkingLevel } from '@earendil-works/pi-ai'
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
  /** Thinking levels the opened model supports. */
  thinkingLevels: readonly ModelThinkingLevel[]
  persist: SettingsPersist
}

export interface DurableSessionDeps extends SettingsDeps {
  send: (message: SidecarMessage) => void
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
  model: SessionReadyPayload['model']
  thinkingLevel: string | null
  thinkingLevels: readonly ModelThinkingLevel[]
  sessionName: string | null
  persist: SettingsPersist
  /** True between `agent_start` and `agent_end`, for `get_stats`' `isStreaming`. */
  streaming: boolean
  /** Set by `abort`, so a run the user cancelled is not reported as a failure. */
  abortRequested: boolean
  /** Set before shutdown: queued messages still settling must not report or export afterwards. */
  closing: boolean
}

/** Commands that act on the live session and have no durable implementation yet. */
const UNSUPPORTED_SESSION_COMMANDS = [
  'execute_bash',
  'reload_session',
  'fork_session',
  'navigate_tree',
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
    session.closing = true
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
    const { harness, model, thinkingLevels, persist } = await deps.open(
      cwd,
      options.workspaceTrusted,
      identity
    )
    const agent = await harness.agentState()
    const session: ActiveSession = {
      harness,
      cwd,
      identity,
      startedAt: deps.now().toISOString(),
      stopEvents: async () => undefined,
      model,
      thinkingLevel: agent.thinkingLevel,
      thinkingLevels,
      persist,
      sessionName: null,
      streaming: false,
      abortRequested: false,
      closing: false,
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
        thinkingLevel: agent.thinkingLevel,
      },
    })
    // After `session_ready`: the renderer resets conversation state on ready, so the snapshot the
    // event feed opens with would be discarded if it arrived first.
    try {
      session.stopEvents = await harness.watchEvents((event) => {
        if (event.type === 'agent_start') session.streaming = true
        if (event.type === 'agent_end') session.streaming = false
        deps.send({ type: 'session_event', event })
      })
    } catch (error) {
      await stop()
      throw error
    }
  }

  /** Slash commands are refused; the context prefix is applied the way the SDK path does. */
  function promptText(cmd: { text: string; contextPrefix?: string }): string {
    const text = cmd.text.trim()
    if (text.startsWith('/')) {
      throw new Error('slash commands are not supported on the durable runtime yet')
    }
    const prefix = cmd.contextPrefix?.trim()
    return prefix ? `${prefix}\n\n${text}` : text
  }

  function reportUnanswered(
    session: ActiveSession,
    result: { status: string; reason?: string }
  ): void {
    if (result.status !== 'unanswered' || session.abortRequested) return
    deps.log(
      'warn',
      `[durable] run ended without an answer${result.reason ? `: ${result.reason}` : ''}`
    )
  }

  async function prompt(cmd: Extract<SidecarCommand, { type: 'prompt' }>): Promise<void> {
    const session = active
    if (!session) return
    const text = promptText(cmd)
    session.abortRequested = false
    reportUnanswered(session, await session.harness.prompt(text))
    await exportNow(session)
  }

  /**
   * Steer / follow-up: returns once the message is admitted, like the SDK's `steer()`. The run it
   * joins (or starts, when idle) is tracked in the background so its outcome is still exported.
   */
  async function queue(
    cmd: Extract<SidecarCommand, { type: 'steer' | 'follow_up' }>
  ): Promise<void> {
    const session = active
    if (!session) return
    const text = promptText(cmd)
    session.abortRequested = false
    const queued = await session.harness.queue(text, cmd.type === 'steer' ? 'steer' : 'followUp')
    void queued.settled
      .then(async (result) => {
        if (session.closing) return
        reportUnanswered(session, result)
        await exportNow(session)
      })
      .catch((error) => {
        if (!session.closing)
          deps.log('error', `[durable] queued message failed: ${errorText(error)}`)
      })
  }

  const view = (session: ActiveSession): InfoSource => ({
    model: session.model,
    identity: session.identity,
    streaming: session.streaming,
    sessionName: session.sessionName,
    thinkingLevel: session.thinkingLevel,
  })

  async function handleCommand(cmd: SidecarCommand): Promise<boolean> {
    if (!active) return false
    if (cmd.type === 'prompt') {
      await prompt(cmd)
      return true
    }
    if (cmd.type === 'steer' || cmd.type === 'follow_up') {
      await queue(cmd)
      return true
    }
    if (isSettingsCommand(cmd)) {
      const session = active
      await applySettingsCommand(cmd, session, deps, () => exportNow(session))
      return true
    }
    if (isInfoCommand(cmd)) {
      const session = active
      await answerInfoCommand(cmd, () => view(session), session.harness, deps.send)
      return true
    }
    if (cmd.type === 'compact') {
      const session = active
      // A run the compaction cuts short is not a failure to report.
      session.abortRequested = true
      if (await runCompact(session.harness, cmd, deps.send)) await exportNow(session)
      return true
    }
    if (cmd.type === 'abort') {
      active.abortRequested = true
      await active.harness.abort()
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
