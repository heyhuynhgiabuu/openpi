import type { DurableStats } from './durable/stats'
import type { DurableHarness } from './durable/types'
import type { SessionReadyPayload, SidecarCommand, SidecarMessage } from './sidecarTypes'

/**
 * Phase 8.3i: the sidecar payloads for `get_stats` and `get_session_info` on a durable session,
 * shaped exactly like the SDK path's so the renderer needs no second code path.
 */

export interface InfoSource {
  model: SessionReadyPayload['model']
  identity: { sessionId: string; sessionFile: string }
  /** True between `agent_start` and `agent_end`. */
  streaming: boolean
  sessionName: string | null
  thinkingLevel: string | null
}

/** Context fill the way the SDK path reports it: all `null` until a response has been seen. */
export function contextFill(model: SessionReadyPayload['model'], tokens: number | null) {
  const window = model?.contextWindow ?? 0
  if (tokens === null || window <= 0) {
    return { contextUsagePercent: null, contextTokens: null, contextWindow: null }
  }
  return {
    contextUsagePercent: (tokens / window) * 100,
    contextTokens: tokens,
    contextWindow: window,
  }
}

export function statsMessage(
  requestId: string,
  source: InfoSource,
  stats: DurableStats
): Extract<SidecarMessage, { type: 'stats_result' }> {
  return {
    type: 'stats_result',
    requestId,
    stats: {
      inputTokens: stats.inputTokens,
      outputTokens: stats.outputTokens,
      cacheReadTokens: stats.cacheReadTokens,
      cacheWriteTokens: stats.cacheWriteTokens,
      cost: stats.cost,
      ...contextFill(source.model, stats.contextTokens),
      sessionFile: source.identity.sessionFile,
      sessionId: source.identity.sessionId,
      isStreaming: source.streaming,
    },
  }
}

export function sessionInfoMessage(
  requestId: string,
  source: InfoSource,
  stats: DurableStats
): Extract<SidecarMessage, { type: 'session_info_result' }> {
  return {
    type: 'session_info_result',
    requestId,
    info: {
      sessionFile: source.identity.sessionFile,
      sessionId: source.identity.sessionId,
      sessionName: source.sessionName,
      model: source.model,
      thinkingLevel: source.thinkingLevel,
      messageCount: stats.messageCount,
      ...contextFill(source.model, stats.contextTokens),
    },
  }
}

export type InfoCommand = Extract<
  SidecarCommand,
  { type: 'get_stats' | 'get_session_info' | 'copy_last_assistant_text' }
>

export function isInfoCommand(cmd: SidecarCommand): cmd is InfoCommand {
  return (
    cmd.type === 'get_stats' ||
    cmd.type === 'get_session_info' ||
    cmd.type === 'copy_last_assistant_text'
  )
}

/** Answer one of the read-only info commands from the harness's stats. */
export async function answerInfoCommand(
  cmd: InfoCommand,
  source: InfoSource,
  harness: Pick<DurableHarness, 'stats'>,
  send: (message: SidecarMessage) => void
): Promise<void> {
  const stats = await harness.stats()
  switch (cmd.type) {
    case 'get_stats':
      send(statsMessage(cmd.requestId, source, stats))
      return
    case 'get_session_info':
      send(sessionInfoMessage(cmd.requestId, source, stats))
      return
    case 'copy_last_assistant_text':
      send({
        type: 'last_assistant_text_result',
        requestId: cmd.requestId,
        text: stats.lastAssistantText,
      })
      return
    default: {
      const unreachable: never = cmd
      return unreachable
    }
  }
}
