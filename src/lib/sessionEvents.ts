import type { Message, SystemMessage, ToolCard } from '../types/session'
import type { SessionEvent } from './ipc'

export function applySessionEvent(
  messages: Message[],
  event: SessionEvent,
  currentModelName?: string | null,
  currentTurnStartMs?: number | null
): Message[] {
  const next = [...messages]

  switch (event.type) {
    case 'message_start': {
      const msg = event.message as { role: string; content?: unknown; timestamp?: number }
      if (msg.role === 'user') {
        next.push({
          id: `u-${msg.timestamp ?? Date.now()}`,
          role: 'user',
          text: contentToText(msg.content),
          toolCards: [],
        })
      } else if (msg.role === 'assistant') {
        next.push({
          id: `a-${msg.timestamp ?? Date.now()}`,
          role: 'assistant',
          text: '',
          toolCards: [],
          streaming: true,
          modelName: currentModelName || undefined,
        })
      }
      return next
    }

    case 'message_update': {
      const last = next.at(-1)
      if (!last || last.role !== 'assistant') return next
      type AssistantMsg = { text: string; thinking?: string } & typeof last
      const lastA = last as AssistantMsg
      const assistantEvent = event.assistantMessageEvent as
        | { type: string; delta?: string }
        | undefined
      if (assistantEvent?.type === 'text_delta' && assistantEvent.delta) {
        next[next.length - 1] = { ...lastA, text: lastA.text + assistantEvent.delta } as Message
      } else if (assistantEvent?.type === 'thinking_delta' && assistantEvent.delta) {
        next[next.length - 1] = {
          ...lastA,
          thinking: (lastA.thinking ?? '') + assistantEvent.delta,
        } as Message
      }
      return next
    }

    case 'message_end': {
      const msg = event.message as {
        role: string
        timestamp?: number
        usage?: UsageLike
      }
      const last = next.at(-1)
      if (last?.role === 'assistant') {
        const durationMs = durationFrom(currentTurnStartMs, msg.timestamp)
        next[next.length - 1] = {
          ...last,
          streaming: false,
          ...(msg.usage ? usageToMessageMetrics(msg.usage) : {}),
          ...(durationMs ? { durationMs } : {}),
        } as Message
      }
      return next
    }

    case 'tool_execution_start': {
      const last = next.at(-1)
      if (!last || last.role !== 'assistant') return next
      type AssistantMsg = { toolCards: ToolCard[] } & typeof last
      const lastA = last as AssistantMsg
      next[next.length - 1] = {
        ...lastA,
        toolCards: [
          ...lastA.toolCards,
          {
            toolCallId: event.toolCallId as string,
            toolName: event.toolName as string,
            args: (event.args ?? {}) as Record<string, unknown>,
            output: '',
            isError: false,
            streaming: true,
          },
        ],
      } as Message
      return next
    }

    case 'tool_execution_update': {
      const last = next.at(-1)
      if (!last || last.role !== 'assistant') return next
      type AssistantMsg = { toolCards: ToolCard[] } & typeof last
      const lastA = last as AssistantMsg
      const toolCallId = event.toolCallId as string
      const output = resultText(event.partialResult)
      next[next.length - 1] = {
        ...lastA,
        toolCards: lastA.toolCards.map((card) =>
          card.toolCallId === toolCallId ? { ...card, output } : card
        ),
      } as Message
      return next
    }

    case 'tool_execution_end': {
      const last = next.at(-1)
      if (!last || last.role !== 'assistant') return next
      type AssistantMsg = { toolCards: ToolCard[] } & typeof last
      const lastA = last as AssistantMsg
      const toolCallId = event.toolCallId as string
      const output = resultText(event.result)
      next[next.length - 1] = {
        ...lastA,
        toolCards: lastA.toolCards.map((card) =>
          card.toolCallId === toolCallId
            ? { ...card, output, isError: !!event.isError, streaming: false }
            : card
        ),
      } as Message
      return next
    }

    // ── Phase 3: compaction / retry system messages ──────────────────────────

    case 'compaction_start': {
      const sys: SystemMessage = {
        id: `compact-${Date.now()}`,
        role: 'system',
        kind: 'compaction',
        text: 'Compacting context…',
        done: false,
      }
      next.push(sys)
      return next
    }

    case 'compaction_end': {
      const e = event as CompactionEndEvent
      const idx = [...next]
        .reverse()
        .findIndex(
          (m) =>
            m.role === 'system' &&
            (m as SystemMessage).kind === 'compaction' &&
            !(m as SystemMessage).done
        )
      const text = formatCompactionEndText(e)
      if (idx !== -1) {
        const realIdx = next.length - 1 - idx
        next[realIdx] = { ...(next[realIdx] as SystemMessage), text, done: true }
      } else {
        // No matching start — still show the result
        next.push({
          id: `compact-end-${Date.now()}`,
          role: 'system',
          kind: 'compaction',
          text,
          done: true,
        })
      }
      return next
    }

    case 'auto_retry_start': {
      const e = event as {
        attempt?: number
        maxAttempts?: number
        delayMs?: number
        errorMessage?: string
      }
      const sys: SystemMessage = {
        id: `retry-${Date.now()}`,
        role: 'system',
        kind: 'retry',
        text: `Auto-retry ${e.attempt ?? 1}/${e.maxAttempts ?? '?'} — ${e.errorMessage ?? 'error'}`,
        done: false,
      }
      next.push(sys)
      return next
    }

    case 'auto_retry_end': {
      const e = event as { success?: boolean; attempt?: number; finalError?: string }
      const idx = [...next]
        .reverse()
        .findIndex(
          (m) =>
            m.role === 'system' &&
            (m as SystemMessage).kind === 'retry' &&
            !(m as SystemMessage).done
        )
      const text = e.success
        ? `Auto-retry succeeded (attempt ${e.attempt ?? '?'})`
        : `Auto-retry failed — ${e.finalError ?? 'unknown error'}`
      if (idx !== -1) {
        const realIdx = next.length - 1 - idx
        next[realIdx] = { ...(next[realIdx] as SystemMessage), text, done: true }
      } else {
        next.push({
          id: `retry-end-${Date.now()}`,
          role: 'system',
          kind: 'retry',
          text,
          done: true,
        })
      }
      return next
    }

    default:
      return next
  }
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((part: unknown) => (part as { type?: string }).type === 'text')
    .map((part: unknown) => (part as { text?: string }).text ?? '')
    .join('')
}

function resultText(result: unknown): string {
  return (
    (result as { content?: Array<{ type: string; text?: string }> } | undefined)?.content
      ?.filter((part) => part.type === 'text')
      .map((part) => part.text ?? '')
      .join('') ?? ''
  )
}

type CompactionEndEvent = {
  aborted?: boolean
  willRetry?: boolean
  errorMessage?: string
  result?: {
    tokensBefore?: unknown
  }
}

export function formatCompactionEndText(event: CompactionEndEvent): string {
  if (event.aborted) return 'Context compaction aborted'

  if (event.errorMessage) {
    return event.willRetry
      ? `Context compaction failed — will retry: ${event.errorMessage}`
      : `Context compaction failed — ${event.errorMessage}`
  }

  const tokensBefore = numeric(event.result?.tokensBefore)
  if (tokensBefore > 0) {
    return `Context compacted — ${tokensBefore.toLocaleString()} tokens before compaction`
  }

  return 'Context compacted'
}

type UsageLike = Record<string, unknown> & {
  cost?: { total?: unknown } | number
}

function usageToMessageMetrics(usage: UsageLike) {
  const cost = usage.cost
  const totalCost = typeof cost === 'number' ? cost : numeric(cost?.total)
  return {
    inputTokens: numeric(usage.input) || numeric(usage.inputTokens),
    outputTokens: numeric(usage.output) || numeric(usage.outputTokens),
    cacheReadTokens: numeric(usage.cacheRead) || numeric(usage.cacheReadTokens),
    cacheWriteTokens: numeric(usage.cacheWrite) || numeric(usage.cacheWriteTokens),
    totalTokens: usageTotalTokens(usage),
    cost: totalCost || undefined,
  }
}

function durationFrom(startMs?: number | null, endMs?: number): number | undefined {
  if (!startMs || !endMs || endMs <= startMs) return undefined
  return endMs - startMs
}

function numeric(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function usageTotalTokens(usage: Record<string, unknown>): number {
  return (
    numeric(usage.totalTokens) ||
    (numeric(usage.input) || numeric(usage.inputTokens)) +
      (numeric(usage.output) || numeric(usage.outputTokens)) +
      (numeric(usage.cacheRead) || numeric(usage.cacheReadTokens)) +
      (numeric(usage.cacheWrite) || numeric(usage.cacheWriteTokens))
  )
}
