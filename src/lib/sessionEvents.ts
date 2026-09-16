import type { ExtensionResponseMessage, Message, SystemMessage, ToolCard } from '../types/session'
import type { SessionEvent } from './ipc'
import { numeric, parseUsage } from './usageParse'

/** The two ctx.ui prompt events, as declared in sessionEventKnownSchema. */
export type UiPromptSessionEvent = Extract<
  SessionEvent,
  { type: 'ui_prompt_start' | 'ui_prompt_end' }
>

/**
 * The session event union keeps an open extension branch whose `type` is any
 * string, so a `type` check cannot narrow on its own. This returns the declared
 * shape the schema already validated, or null for every other event.
 */
export function asUiPromptEvent(event: SessionEvent): UiPromptSessionEvent | null {
  if (event.type !== 'ui_prompt_start' && event.type !== 'ui_prompt_end') return null
  // SAFETY: sessionEventKnownSchema validated id/kind/title for these two types.
  return event as UiPromptSessionEvent
}

export function applySessionEvent(
  messages: Message[],
  event: SessionEvent,
  currentModelName?: string | null,
  currentTurnStartMs?: number | null
): Message[] {
  /*
   * PERF: no upfront spread. Each case creates `next` only when it actually
   * needs to modify the array. Early-exit paths and the `default` case return
   * the original `messages` reference so downstream memos (groupMessages,
   * aggregateUsage) see no change and skip recomputation.
   */
  switch (event.type) {
    case 'message_start': {
      const msg = event.message as { role: string; content?: unknown; timestamp?: number }
      if (msg.role === 'user') {
        return [
          ...messages,
          {
            id: `u-${msg.timestamp ?? Date.now()}`,
            role: 'user',
            text: contentToText(msg.content),
            toolCards: [],
          },
        ]
      }
      if (msg.role === 'assistant') {
        return [
          ...messages,
          {
            id: `a-${msg.timestamp ?? Date.now()}`,
            role: 'assistant',
            text: '',
            toolCards: [],
            streaming: true,
            modelName: currentModelName || undefined,
          },
        ]
      }
      if (msg.role === 'custom') {
        const custom = msg as {
          customType?: string
          content?: unknown
          details?: { level?: 'info' | 'warn' | 'error' }
          display?: boolean
          timestamp?: number
        }
        if (custom.display === false) return messages
        const raw = contentToText(custom.content)
        if (!raw.trim()) return messages
        // Extension command output (e.g. /fff-health) renders as a
        // distinct response card in the conversation, not as a user
        // prompt or a code block in an assistant message.
        const id = `ext-${custom.timestamp ?? Date.now()}`
        const extMsg: ExtensionResponseMessage = {
          id,
          role: 'extension',
          text: raw,
          commandName: '',
          level: custom.details?.level ?? 'info',
          timestamp: custom.timestamp ?? Date.now(),
        }
        return [...messages, extMsg]
      }
      return messages
    }

    case 'message_update': {
      // Hot path: fired 100s–1000s of times during streaming.
      // Only copy when there is an actual delta to apply.
      const last = messages.at(-1)
      if (!last || last.role !== 'assistant') return messages
      type AssistantMsg = { text: string; thinking?: string } & typeof last
      const lastA = last as AssistantMsg
      const assistantEvent = event.assistantMessageEvent as
        | { type: string; delta?: string }
        | undefined
      if (assistantEvent?.type === 'text_delta' && assistantEvent.delta) {
        const next = [...messages]
        next[next.length - 1] = { ...lastA, text: lastA.text + assistantEvent.delta }
        return next
      }
      if (assistantEvent?.type === 'thinking_delta' && assistantEvent.delta) {
        const next = [...messages]
        next[next.length - 1] = {
          ...lastA,
          thinking: (lastA.thinking ?? '') + assistantEvent.delta,
        }
        return next
      }
      return messages // no applicable delta — no copy
    }

    case 'message_end': {
      const msg = event.message as { role: string; timestamp?: number; usage?: unknown }
      const last = messages.at(-1)
      if (last?.role !== 'assistant') return messages
      const durationMs = durationFrom(currentTurnStartMs, msg.timestamp)
      const next = [...messages]
      const updated: Message = { ...last, streaming: false }
      if (msg.usage) Object.assign(updated, usageToMessageMetrics(msg.usage))
      if (durationMs) updated.durationMs = durationMs
      next[next.length - 1] = updated
      return next
    }

    case 'tool_execution_start': {
      const last = messages.at(-1)
      if (!last || last.role !== 'assistant') return messages
      type AssistantMsg = { toolCards: ToolCard[] } & typeof last
      const lastA = last as AssistantMsg
      const next = [...messages]
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
            startedAt: Date.now(),
          },
        ],
      }
      return next
    }

    case 'tool_execution_update': {
      // Also a hot path during long-running tool calls.
      const last = messages.at(-1)
      if (!last || last.role !== 'assistant') return messages
      type AssistantMsg = { toolCards: ToolCard[] } & typeof last
      const lastA = last as AssistantMsg
      const toolCallId = event.toolCallId as string
      const output = resultText(event.partialResult)
      const partialDetails =
        event.details && typeof event.details === 'object'
          ? (event.details as Record<string, unknown>)
          : undefined
      const next = [...messages]
      next[next.length - 1] = {
        ...lastA,
        toolCards: lastA.toolCards.map((card) => {
          if (card.toolCallId !== toolCallId) return card
          if (!partialDetails) return { ...card, output }
          return { ...card, output, details: { ...card.details, ...partialDetails } }
        }),
      }
      return next
    }

    case 'tool_execution_end': {
      const last = messages.at(-1)
      if (!last || last.role !== 'assistant') return messages
      type AssistantMsg = { toolCards: ToolCard[] } & typeof last
      const lastA = last as AssistantMsg
      const toolCallId = event.toolCallId as string
      const output = resultText(event.result)
      const endDetails =
        event.details && typeof event.details === 'object'
          ? (event.details as Record<string, unknown>)
          : undefined
      const next = [...messages]
      next[next.length - 1] = {
        ...lastA,
        toolCards: lastA.toolCards.map((card) => {
          if (card.toolCallId !== toolCallId) return card
          const base = { ...card, output, isError: !!event.isError, streaming: false }
          return endDetails ? { ...base, details: endDetails } : base
        }),
      }
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
      return [...messages, sys]
    }

    case 'compaction_end': {
      const e = event as CompactionEndEvent
      const next = [...messages]
      const idx = [...next]
        .reverse()
        .findIndex(
          (m) =>
            m.role === 'system' &&
            (m as SystemMessage).kind === 'compaction' &&
            !(m as SystemMessage).done
        )
      const text = formatCompactionEndText(e)
      const compactionData: Partial<SystemMessage> = {
        text,
        done: true,
        tokensBefore: numeric(e.result?.tokensBefore),
        reason: (e.reason as SystemMessage['reason']) ?? undefined,
        summary: e.result?.summary ?? undefined,
        readFiles: e.result?.details?.readFiles ?? undefined,
        modifiedFiles: e.result?.details?.modifiedFiles ?? undefined,
      }
      if (idx !== -1) {
        const realIdx = next.length - 1 - idx
        next[realIdx] = { ...(next[realIdx] as SystemMessage), ...compactionData }
      } else {
        next.push({
          id: `compact-end-${Date.now()}`,
          role: 'system',
          kind: 'compaction',
          ...compactionData,
        } as SystemMessage)
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
      return [...messages, sys]
    }

    case 'auto_retry_end': {
      const e = event as { success?: boolean; attempt?: number; finalError?: string }
      const next = [...messages]
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

    case 'extension_error': {
      // Load failures AND resource conflicts (Pi keeps conflicting extensions
      // loaded and reports them through the same diagnostics array) arrive
      // here, synthesized by the sidecar for load-time issues; runtime
      // failures come from Pi itself. Same shape either way: extensionPath
      // + error. Neutral wording — a conflict is not a load failure.
      const e = event as { extensionPath?: string; error?: string }
      const sys: SystemMessage = {
        id: `ext-err-${Date.now()}`,
        role: 'system',
        kind: 'extension',
        text: `Extension issue: ${e.extensionPath ?? 'unknown'} — ${e.error ?? 'error'}`,
        done: true,
      }
      return [...messages, sys]
    }

    default:
      // Unknown event — return the original array, no copy, no reactivity.
      return messages
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
  reason?: string
  aborted?: boolean
  willRetry?: boolean
  errorMessage?: string
  result?: {
    tokensBefore?: unknown
    summary?: string
    firstKeptEntryId?: string
    details?: {
      readFiles?: string[]
      modifiedFiles?: string[]
    }
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
  const prefix =
    event.reason === 'manual'
      ? 'Manually compacted'
      : event.reason === 'overflow'
        ? 'Compacted on overflow'
        : 'Compacted'

  if (tokensBefore > 0) {
    return `${prefix} from ${tokensBefore.toLocaleString()} tokens`
  }

  return 'Context compacted'
}

function usageToMessageMetrics(usage: unknown) {
  const parsed = parseUsage(usage)
  return {
    inputTokens: parsed.input,
    outputTokens: parsed.output,
    cacheReadTokens: parsed.cacheRead,
    cacheWriteTokens: parsed.cacheWrite,
    totalTokens: parsed.total,
    cost: parsed.cost || undefined,
  }
}

function durationFrom(startMs?: number | null, endMs?: number): number | undefined {
  if (!startMs || !endMs || endMs <= startMs) return undefined
  return endMs - startMs
}
