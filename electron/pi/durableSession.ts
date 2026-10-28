import { answerInfoCommand, isInfoCommand, type InfoSource } from './durableInfo'
import {
  applySettingsCommand,
  isSettingsCommand,
  type SettingsDeps,
  type SettingsPersist,
} from './durableSettings'
import { runCompact } from './durableCompact'
import { errorText, promptText } from './durablePrompt'
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

/** Commands that act on the live session and have no durable implementation yet. */
const UNSUPPORTED_SESSION_COMMANDS = [
  'fork_session',
  'navigate_tree',
] as const satisfies readonly SidecarCommand['type'][]

function isUnsupported(type: SidecarCommand['type']): boolean {
  return (UNSUPPORTED_SESSION_COMMANDS as readonly string[]).includes(type)
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

  /** What `session_ready` reports about a freshly opened harness. */
  async function inspectOpened(opened: DurableOpenResult, options: DurableStartOptions) {
    const { harness } = opened
    const agent = await harness.agentState()
    // A reopened session keeps the model it was using, which may not be today's default. A new
    // one was opened with its model, so there is nothing to look up.
    let { model, thinkingLevels } = opened
    if (
      options.resume &&
      agent.model &&
      (model?.provider !== agent.model.provider || model?.id !== agent.model.modelId)
    ) {
      const stored = await deps
        .resolveModel(agent.model.provider, agent.model.modelId)
        .catch((error) => {
          deps.log('warn', `[durable] looking up the stored model failed: ${errorText(error)}`)
          return undefined
        })
      if (stored) ({ info: model, thinkingLevels } = stored)
      else {
        deps.log(
          'warn',
          `[durable] stored model ${agent.model.provider}/${agent.model.modelId} is not available; ` +
            `reporting ${model?.provider}/${model?.id}, though the session still uses the stored one`
        )
      }
    }
    const sessionName = options.resume ? (await harness.stats()).sessionName : null
    return { agent, model, thinkingLevels, sessionName }
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
      ready = await inspectOpened(opened, options)
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
    }
    active = session
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

  /**
   * `reload_session`: a full restart of the harness over the same store, file and header, so
   * extensions, customizations and MCP servers are discovered afresh and the history is untouched.
   * A run in flight is aborted first, as the SDK path's dispose does: merely closing the harness
   * would leave the run pending in the store, and the next submit would start it again.
   */
  async function reload(session: ActiveSession, requestId: string): Promise<void> {
    session.abortRequested = true
    await session.harness.abort()
    await exportNow(session)
    await start(session.cwd, {
      workspaceTrusted: session.workspaceTrusted,
      requestId,
      resume: { identity: session.identity, startedAt: session.startedAt },
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
    if (cmd.type === 'execute_bash') {
      const session = active
      const result = await session.harness.executeBash(cmd.command, {
        excludeFromContext: cmd.excludeFromContext,
      })
      deps.send({ type: 'bash_result', requestId: cmd.requestId, result })
      await exportNow(session)
      return true
    }
    if (cmd.type === 'reload_session') {
      await reload(active, cmd.requestId)
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
