import type { Usage } from '@earendil-works/pi-ai'
import { AssistantEntry } from '@earendil-works/pi-durable'
import type { EntryRecord } from '@earendil-works/pi-durable'
import { z } from 'zod'
import { messageText } from './text'

/**
 * Phase 8.3i: the numbers behind `get_stats` / `get_session_info` / `copy_last_assistant_text`,
 * computed from what pi-durable already records (its usage ledger and the transcript), so there is
 * no second counter to drift out of sync.
 */

export interface DurableStats {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cost: number
  /** Model-visible messages, the SDK path's `messageCount`. */
  messageCount: number
  lastAssistantText: string | null
  /** Tokens the last model response saw; `null` until there has been one. */
  contextTokens: number | null
  /** The latest non-empty name recorded with `setSessionName`, or `null`. */
  sessionName: string | null
}

/** The part of pi-ai's `Usage` we sum; unknown or missing counters count as zero. */
const usageSchema = z
  .object({
    input: z.number().default(0),
    output: z.number().default(0),
    cacheRead: z.number().default(0),
    cacheWrite: z.number().default(0),
    cost: z
      .object({ total: z.number().default(0) })
      .partial()
      .default({}),
  })
  .passthrough()

const usageBucketsSchema = z.object({
  models: z.record(z.string(), z.unknown()).default({}),
  tools: z.record(z.string(), z.unknown()).default({}),
})

interface Totals {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cost: number
}

/** Sum the ledger's model and tool buckets; a bucket that does not parse contributes nothing. */
function sumUsage(ledger: unknown): Totals {
  const totals: Totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }
  const buckets = usageBucketsSchema.safeParse(ledger)
  if (!buckets.success) return totals
  for (const raw of [...Object.values(buckets.data.models), ...Object.values(buckets.data.tools)]) {
    const usage = usageSchema.safeParse(raw)
    if (!usage.success) continue
    totals.input += usage.data.input
    totals.output += usage.data.output
    totals.cacheRead += usage.data.cacheRead
    totals.cacheWrite += usage.data.cacheWrite
    totals.cost += usage.data.cost.total ?? 0
  }
  return totals
}

/** Total tokens the last assistant response consumed, which is what fills the context window. */
function lastContextTokens(entries: readonly EntryRecord[]): number | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (!entry || !AssistantEntry.is(entry)) continue
    const message = entry.model?.[0]
    if (message?.role !== 'assistant') continue
    const usage: Usage = message.usage
    const total =
      usage.totalTokens > 0
        ? usage.totalTokens
        : usage.input + usage.output + usage.cacheRead + usage.cacheWrite
    return total > 0 ? total : null
  }
  return null
}

function lastAssistantText(entries: readonly EntryRecord[]): string | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (!entry || !AssistantEntry.is(entry)) continue
    const text = messageText(entry.model?.[0])
    if (text !== undefined && text !== '') return text
  }
  return null
}

/** Entry kind of a session-name write; the exporter turns it into a JSONL v3 `session_info` line. */
export const SESSION_NAME_KIND = 'openpi.session_name'

const sessionNameData = z.object({ name: z.string() })

/** The name carried by a session-name entry, trimmed; `undefined` for any other entry or an empty name. */
export function sessionNameOf(entry: EntryRecord): string | undefined {
  if (entry.kind !== SESSION_NAME_KIND) return undefined
  const data = sessionNameData.safeParse(entry.data)
  const name = data.success ? data.data.name.trim() : ''
  return name === '' ? undefined : name
}

function latestSessionName(entries: readonly EntryRecord[]): string | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    const name = entry ? sessionNameOf(entry) : undefined
    if (name !== undefined) return name
  }
  return null
}

export function computeStats(
  ledger: unknown,
  entries: readonly EntryRecord[],
  messageCount: number
): DurableStats {
  const totals = sumUsage(ledger)
  return {
    inputTokens: totals.input,
    outputTokens: totals.output,
    cacheReadTokens: totals.cacheRead,
    cacheWriteTokens: totals.cacheWrite,
    cost: totals.cost,
    messageCount,
    lastAssistantText: lastAssistantText(entries),
    contextTokens: lastContextTokens(entries),
    sessionName: latestSessionName(entries),
  }
}
