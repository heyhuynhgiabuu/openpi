import { answerInfoCommand, isInfoCommand, type InfoSource } from './durableInfo'
import {
  applySettingsCommand,
  isSettingsCommand,
  type SettingsDeps,
  type SettingsPersist,
} from './durableSettings'
import { counted, countedUnlessAborted, newActivity } from './durableActivity'
import { durableHeaderOf, resumeDurableFromFile } from './durableResume'
import { runCompact } from './durableCompact'
import { forkSession, navigateSession, reloadSession, type FlowOps } from './durableFlow'
import { errorText, promptText } from './durablePrompt'
import { inspectOpened } from './durableOpen'
import type { SidecarCommand } from './sidecarTypes'
import type {
  ActiveSession,
  DurableOpenResult,
  DurableSessionDeps,
  DurableSessions,
  DurableStartOptions,
} from './durableTypes'

export type {
  DurableIdentity,
  DurableOpenResult,
  DurableSessionDeps,
  DurableSessions,
  DurableStartOptions,
} from './durableTypes'

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

export function createDurableSessions(deps: DurableSessionDeps): DurableSessions {
  let active: ActiveSession | null = null

  /** Write the session file; throws when it cannot be written. */
  async function exportStrict(session: ActiveSession): Promise<void> {
    await session.harness.exportSession(session.identity.sessionFile, {
      sessionId: session.identity.sessionId,
      cwd: session.cwd,
      startedAt: session.startedAt,
      durable: durableHeaderOf(session.identity, session.harness.conversationIds()),
    })
    deps.send({ type: 'session_index_updated' })
  }

  /** Write the session file after a change; a failure is logged, since the session itself is fine. */
  async function exportNow(session: ActiveSession): Promise<void> {
    try {
      await exportStrict(session)
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

  /** Follow the harness's current conversation; again after it moves to another branch. */
  async function attachEvents(session: ActiveSession): Promise<void> {
    session.stopEvents = await session.harness.watchEvents((event) => {
      if (event.type === 'agent_start') session.streaming = true
      if (event.type === 'agent_end') session.streaming = false
      deps.send({ type: 'session_event', event })
    })
  }

  async function start(cwd: string, options: DurableStartOptions): Promise<void> {
    await stop()
    const identity = options.resume?.identity ?? deps.newIdentity(cwd)
    const opened = await deps.open(cwd, options.workspaceTrusted, identity)
    const { harness, persist } = opened
    // Anything that fails between opening the harness and registering it would leave its store
    // and MCP connections open with nothing able to close them.
    let ready: Awaited<ReturnType<typeof inspectOpened>>
    try {
      ready = await inspectOpened(deps, opened, options)
    } catch (error) {
      await harness.close().catch((closeError) => {
        deps.log('warn', `[durable] closing after a failed start: ${errorText(closeError)}`)
      })
      throw error
    }
    const { agent, model, thinkingLevels, sessionName } = ready
    const session: ActiveSession = {
      harness,
      cwd,
      workspaceTrusted: options.workspaceTrusted,
      identity,
      startedAt: options.resume?.startedAt ?? deps.now().toISOString(),
      stopEvents: async () => undefined,
      model,
      thinkingLevel: agent.thinkingLevel,
      thinkingLevels,
      persist,
      sessionName,
      streaming: false,
      abortRequested: false,
      closing: false,
      activity: newActivity(),
    }
    active = session
    // A reopened or forked session already has a history, and the renderer reads it from the file:
    // announcing the session without that file would show an empty conversation as a success.
    if (options.resume) {
      try {
        await exportStrict(session)
      } catch (error) {
        await stop()
        throw error
      }
    }
    deps.send({
      type: 'session_ready',
      requestId: options.requestId,
      payload: {
        cwd,
        sessionFile: identity.sessionFile,
        sessionId: identity.sessionId,
        sessionName,
        model,
        thinkingLevel: agent.thinkingLevel,
      },
    })
    // After `session_ready`: the renderer resets conversation state on ready, so the snapshot the
    // event feed opens with would be discarded if it arrived first.
    try {
      await attachEvents(session)
    } catch (error) {
      await stop()
      throw error
    }
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
    const result = await countedUnlessAborted(session.activity, () => session.harness.prompt(text))
    if (result) reportUnanswered(session, result)
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
    const mode = cmd.type === 'steer' ? 'steer' : 'followUp'
    const queued = await countedUnlessAborted(session.activity, () =>
      session.harness.queue(text, mode)
    )
    if (!queued) return
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

  const flow: FlowOps = {
    exportNow,
    start,
    newIdentity: deps.newIdentity,
    now: deps.now,
    log: deps.log,
    send: deps.send,
    reattachEvents: attachEvents,
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
      // Counted, and after any navigation in progress: a change made meanwhile must land on the
      // branch the session ends up on, not the one it is leaving.
      await counted(session.activity, 'replies', () =>
        applySettingsCommand(cmd, session, deps, () => exportNow(session))
      )
      return true
    }
    if (isInfoCommand(cmd)) {
      const session = active
      await answerInfoCommand(cmd, () => view(session), session.harness, deps.send)
      return true
    }
    if (cmd.type === 'execute_bash') {
      const session = active
      // Counted, so a command is neither recorded on a branch being left nor overlapped by one.
      const result = await counted(session.activity, 'replies', () =>
        session.harness.executeBash(cmd.command, { excludeFromContext: cmd.excludeFromContext })
      )
      deps.send({ type: 'bash_result', requestId: cmd.requestId, result })
      await exportNow(session)
      return true
    }
    if (cmd.type === 'fork_session') {
      await forkSession(active, cmd, flow)
      return true
    }
    if (cmd.type === 'navigate_tree') {
      await navigateSession(active, cmd, flow)
      return true
    }
    if (cmd.type === 'reload_session') {
      await reloadSession(active, cmd.requestId, flow)
      return true
    }
    if (cmd.type === 'compact') {
      const session = active
      // A run the compaction cuts short is not a failure to report.
      session.abortRequested = true
      const compacted = await counted(session.activity, 'maintenance', () =>
        runCompact(session.harness, cmd, deps.send)
      )
      if (compacted) await exportNow(session)
      return true
    }
    if (cmd.type === 'abort') {
      active.abortRequested = true
      active.activity.aborts += 1
      await active.harness.abort()
      return true
    }
    if (cmd.type === 'stop') {
      await stop()
      return false
    }
    return false
  }

  /** See `resumeFromFile`: only a file this runtime wrote can be reopened. */
  const resumeFrom = (cwd: string, sessionFile: string, workspaceTrusted: boolean) =>
    resumeDurableFromFile(cwd, sessionFile, workspaceTrusted, start)

  return { isActive: () => active !== null, start, resumeFrom, handleCommand, stop }
}
