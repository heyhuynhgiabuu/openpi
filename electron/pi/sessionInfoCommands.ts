/**
 * Session-information sidecar commands: display name, session info, stats,
 * compaction, and last-assistant-text copy. Pure move of the corresponding
 * cases from sidecar.ts's command switch.
 */

import type { SidecarCommand } from './sidecarTypes'
import { getState, send } from './sidecarContext'

export async function handleSetSessionNameCommand(
  cmd: Extract<SidecarCommand, { type: 'set_session_name' }>
): Promise<void> {
  const state = getState()
  if (!state) return
  state.session.setSessionName(cmd.name)
}

export async function handleGetSessionInfoCommand(
  cmd: Extract<SidecarCommand, { type: 'get_session_info' }>
): Promise<void> {
  const state = getState()
  if (!state) {
    send({
      type: 'session_info_result',
      requestId: cmd.requestId,
      info: {
        sessionFile: null,
        sessionId: null,
        sessionName: null,
        model: null,
        thinkingLevel: null,
        messageCount: 0,
        contextUsagePercent: null,
        contextTokens: null,
        contextWindow: null,
      },
    })
    return
  }
  const session = state.session
  const stats = session.getSessionStats()
  const ctx = stats.contextUsage ?? session.getContextUsage()
  const model = session.model as
    | {
        id: string
        name: string
        provider: string
        reasoning?: boolean
        contextWindow?: number
      }
    | undefined
  const messages = (session.agent as { state?: { messages?: unknown[] } }).state?.messages ?? []
  send({
    type: 'session_info_result',
    requestId: cmd.requestId,
    info: {
      sessionFile: stats.sessionFile ?? session.sessionFile ?? null,
      sessionId: stats.sessionId ?? session.sessionId ?? null,
      sessionName: session.sessionName ?? null,
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
      messageCount: messages.length,
      contextUsagePercent: ctx?.percent ?? null,
      contextTokens: ctx?.tokens ?? null,
      contextWindow: ctx?.contextWindow ?? null,
    },
  })
}

export async function handleCompactCommand(
  cmd: Extract<SidecarCommand, { type: 'compact' }>
): Promise<void> {
  const state = getState()
  if (!state) {
    send({
      type: 'error',
      requestId: cmd.requestId,
      message: 'No active session',
    })
    return
  }
  // Pi SDK's session.compact() emits `compaction_start` and
  // `compaction_end` events. The session event bridge already
  // forwards them to the renderer, so the UI updates naturally.
  try {
    await state.session.compact(cmd.customInstructions)
    send({ type: 'compact_result', requestId: cmd.requestId })
  } catch (err) {
    send({
      type: 'error',
      requestId: cmd.requestId,
      message: err instanceof Error ? err.message : String(err),
    })
  }
}

export async function handleCopyLastAssistantTextCommand(
  cmd: Extract<SidecarCommand, { type: 'copy_last_assistant_text' }>
): Promise<void> {
  const state = getState()
  if (!state) {
    send({
      type: 'error',
      requestId: cmd.requestId,
      message: 'No active session',
    })
    return
  }
  const text = state.session.getLastAssistantText() ?? null
  send({
    type: 'last_assistant_text_result',
    requestId: cmd.requestId,
    text,
  })
}

export async function handleGetStatsCommand(
  cmd: Extract<SidecarCommand, { type: 'get_stats' }>
): Promise<void> {
  const state = getState()
  if (!state) {
    send({
      type: 'stats_result',
      requestId: cmd.requestId,
      stats: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cost: 0,
        contextUsagePercent: null,
        contextTokens: null,
        contextWindow: null,
        sessionFile: null,
        sessionId: null,
        isStreaming: false,
      },
    })
    return
  }
  // Use the Pi SDK's authoritative pre-computed stats —
  // do NOT manually sum from agent.state.messages (wrong data source).
  const sdkStats = state.session.getSessionStats()
  // contextUsage gives current context window fill (what Pi TUI shows),
  // NOT the cumulative session totals from getSessionStats().tokens.
  const ctxUsage = sdkStats.contextUsage ?? state.session.getContextUsage()
  send({
    type: 'stats_result',
    requestId: cmd.requestId,
    stats: {
      inputTokens: sdkStats.tokens.input,
      outputTokens: sdkStats.tokens.output,
      cacheReadTokens: sdkStats.tokens.cacheRead,
      cacheWriteTokens: sdkStats.tokens.cacheWrite,
      cost: sdkStats.cost,
      contextUsagePercent: ctxUsage?.percent ?? null,
      contextTokens: ctxUsage?.tokens ?? null,
      contextWindow: ctxUsage?.contextWindow ?? null,
      sessionFile: sdkStats.sessionFile ?? state.session.sessionFile ?? null,
      sessionId: sdkStats.sessionId ?? state.session.sessionId ?? null,
      isStreaming:
        (state.session.agent as unknown as { state?: { isStreaming?: boolean } }).state
          ?.isStreaming ?? false,
    },
  })
}
