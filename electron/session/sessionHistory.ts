/**
 * sessionHistory.ts — Session history page reading and message rendering.
 * Extracted from sessionEntries.ts.
 */

import type { SessionHistoryMessage, SessionHistoryToolCard } from '../../src/lib/ipc'
import type { SessionEntry } from './sessionEntries'
import {
  contentToText,
  durationFrom,
  entryTimestampMs,
  isRecord,
  numeric,
  usageTotalTokens,
} from './sessionEntryUtils'

// ─── Types ─────────────────────────────────────────────────────────────────

export type HistoryReadState = {
  currentModelName?: string
  lastUserTimestampMs: number | null
}

// ─── Message rendering ─────────────────────────────────────────────────────

export function appendHistoryEntry(
  messages: SessionHistoryMessage[],
  entry: SessionEntry,
  state: HistoryReadState
): void {
  if (entry.type === 'model_change') {
    const e = entry as unknown as { modelId?: string; provider?: string }
    state.currentModelName = e.modelId || state.currentModelName
    return
  }

  if (entry.type !== 'message') return

  const message = entry.message as unknown as Record<string, unknown>
  const role = typeof message.role === 'string' ? message.role : ''

  if (role === 'user') {
    state.lastUserTimestampMs = entryTimestampMs(entry, message)
    pushRenderableMessage(messages, {
      id: entry.id,
      role: 'user',
      text: contentToText(message.content),
      toolCards: [],
    })
    return
  }

  if (role === 'assistant') {
    const usage = isRecord(message.usage) ? message.usage : {}
    const cost = isRecord(usage.cost) ? numeric(usage.cost.total) : numeric(usage.cost)
    const durationMs = durationFrom(state.lastUserTimestampMs, entryTimestampMs(entry, message))
    pushRenderableMessage(messages, {
      id: entry.id,
      role: 'assistant',
      text: assistantText(message.content),
      thinking: assistantThinking(message.content) || undefined,
      toolCards: toolCallsFromContent(message.content),
      inputTokens: numeric(usage.input) || numeric(usage.inputTokens),
      outputTokens: numeric(usage.output) || numeric(usage.outputTokens),
      cacheReadTokens: numeric(usage.cacheRead) || numeric(usage.cacheReadTokens),
      cacheWriteTokens: numeric(usage.cacheWrite) || numeric(usage.cacheWriteTokens),
      totalTokens: usageTotalTokens(usage),
      durationMs,
      cost: cost || undefined,
      streaming: false,
      modelName: state.currentModelName,
    })
    return
  }

  if (role === 'toolResult') {
    attachToolResult(messages, message)
    return
  }

  if (role === 'bashExecution') {
    pushRenderableMessage(messages, {
      id: entry.id,
      role: 'assistant',
      text: '',
      toolCards: [
        {
          toolCallId: entry.id,
          toolName: 'bash',
          args: { command: typeof message.command === 'string' ? message.command : '' },
          output: typeof message.output === 'string' ? message.output : '',
          isError: numeric(message.exitCode) !== 0,
          streaming: false,
        },
      ],
    })
  }
}

export function pushRenderableMessage(
  messages: SessionHistoryMessage[],
  message: SessionHistoryMessage
): void {
  if (isRenderableHistoryMessage(message)) messages.push(message)
}

export function trimHistoryMessages(messages: SessionHistoryMessage[], limit: number): boolean {
  let trimmed = false
  while (messages.length > limit) {
    messages.shift()
    trimmed = true
  }
  return trimmed
}

export function isRenderableHistoryMessage(message: SessionHistoryMessage): boolean {
  return Boolean(message.text || message.thinking || message.toolCards.length > 0)
}

export function attachToolResult(
  messages: SessionHistoryMessage[],
  message: Record<string, unknown>
): void {
  const toolCallId = typeof message.toolCallId === 'string' ? message.toolCallId : ''
  if (!toolCallId) return

  const fallbackCard: SessionHistoryToolCard = {
    toolCallId,
    toolName: typeof message.toolName === 'string' ? message.toolName : 'tool',
    args: {},
    output: contentToText(message.content),
    isError: Boolean(message.isError),
    streaming: false,
  }

  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const candidate = messages[messageIndex]
    if (candidate.role !== 'assistant') continue
    const cardIndex = candidate.toolCards.findIndex((card) => card.toolCallId === toolCallId)
    if (cardIndex === -1) continue
    candidate.toolCards[cardIndex] = {
      ...candidate.toolCards[cardIndex],
      output: fallbackCard.output,
      isError: fallbackCard.isError,
      streaming: false,
    }
    return
  }

  messages.push({
    id: `tool-${toolCallId}`,
    role: 'assistant',
    text: '',
    toolCards: [fallbackCard],
    streaming: false,
  })
}

function toolCallsFromContent(content: unknown): SessionHistoryToolCard[] {
  if (!Array.isArray(content)) return []
  return content.flatMap((part): SessionHistoryToolCard[] => {
    if (!isRecord(part) || part.type !== 'toolCall') return []
    const toolCallId = typeof part.id === 'string' ? part.id : ''
    const toolName = typeof part.name === 'string' ? part.name : 'tool'
    if (!toolCallId) return []
    return [
      {
        toolCallId,
        toolName,
        args: isRecord(part.arguments) ? part.arguments : {},
        output: '',
        isError: false,
        streaming: false,
      },
    ]
  })
}

function assistantText(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (isRecord(part) && part.type === 'text') return String(part.text ?? '')
      return ''
    })
    .join('')
    .trim()
}

function assistantThinking(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (isRecord(part) && part.type === 'thinking') return String(part.thinking ?? '')
      return ''
    })
    .join('\n')
    .trim()
}
