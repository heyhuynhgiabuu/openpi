import { createReadStream, existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import type { Message } from '@earendil-works/pi-ai'
import { z } from 'zod'

/**
 * Phase 8.3: one-time import of Pi's JSONL v3 sessions into the durable store.
 *
 * Read-only with respect to the source: the JSONL file is never rewritten, moved, or deleted, so a
 * failed or repeated import cannot lose history. Output is a linear transcript (the durable model
 * has no parentId tree); branches are imported along the active leaf chain, and everything else is
 * reported as a diagnostic instead of being invented.
 */

const baseEntry = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  timestamp: z.string(),
})

/** Only the entry kinds that carry model-visible messages are imported; the rest are tallied. */
const messageEntry = baseEntry.extend({
  type: z.literal('message'),
  message: z.unknown(),
})
const headerEntry = z.object({ type: z.literal('session') }).passthrough()
const looseEntry = baseEntry.extend({ type: z.string() }).passthrough()

export interface ImportedMessage {
  role: 'user' | 'assistant' | 'toolResult' | 'system'
  message: Message
}

export interface ImportResult {
  /** Messages in transcript order, along the leaf chain. */
  messages: ImportedMessage[]
  /** Entry counts by kind, so a caller can report what was skipped. */
  counts: Record<string, number>
  /** Entries not imported, with the reason. */
  skipped: string[]
  /** True when the file has no `session` header or could not be parsed as v3. */
  invalid: boolean
}

/** Narrow an unknown JSONL `message` payload to a pi-ai `Message` without casting. */
function asMessage(value: unknown): Message | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as { role?: unknown }
  if (
    candidate.role === 'user' ||
    candidate.role === 'assistant' ||
    candidate.role === 'toolResult' ||
    candidate.role === 'system'
  ) {
    return value as Message
  }
  return undefined
}

/** Read every JSONL line of a session file, tolerating unparseable lines. */
export async function readSessionEntries(
  filePath: string
): Promise<{ entries: unknown[]; invalid: number }> {
  const entries: unknown[] = []
  let invalid = 0
  const stream = createReadStream(filePath, { encoding: 'utf-8' })
  const lines = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY })
  for await (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      entries.push(JSON.parse(trimmed))
    } catch {
      invalid += 1
    }
  }
  return { entries, invalid }
}

/**
 * Import one session file into a message list.
 *
 * Ordering: the leaf (the newest entry) is followed back through `parentId` to the root, then
 * reversed, which yields exactly the active branch. Sibling branches stay in the file untouched.
 */
export async function importSessionFile(filePath: string): Promise<ImportResult> {
  const counts: Record<string, number> = {}
  const skipped: string[] = []
  if (!existsSync(filePath)) {
    return { messages: [], counts, skipped: ['file does not exist'], invalid: true }
  }

  const { entries, invalid } = await readSessionEntries(filePath)
  if (invalid > 0) skipped.push(`${invalid} unparseable line(s) ignored`)

  const byId = new Map<string, unknown>()
  const order: string[] = []
  let sawHeader = false
  for (const entry of entries) {
    const header = headerEntry.safeParse(entry)
    if (header.success) {
      sawHeader = true
      continue
    }
    const parsed = looseEntry.safeParse(entry)
    if (!parsed.success) {
      skipped.push('entry without id/parentId/timestamp')
      continue
    }
    const kind = parsed.data.type
    counts[kind] = (counts[kind] ?? 0) + 1
    byId.set(parsed.data.id, entry)
    order.push(parsed.data.id)
  }
  if (!sawHeader) return { messages: [], counts, skipped, invalid: true }

  // Walk from the last entry (the leaf) back to the root through parentId.
  const chain: string[] = []
  let cursor = order.at(-1)
  const seen = new Set<string>()
  while (cursor !== undefined && !seen.has(cursor)) {
    seen.add(cursor)
    chain.push(cursor)
    const parsed = looseEntry.safeParse(byId.get(cursor))
    if (!parsed.success) break
    cursor = parsed.data.parentId ?? undefined
  }
  chain.reverse()

  const messages: ImportedMessage[] = []
  for (const id of chain) {
    const entry = byId.get(id)
    const parsed = messageEntry.safeParse(entry)
    if (!parsed.success) continue
    const message = asMessage(parsed.data.message)
    if (!message) {
      skipped.push(`message entry ${id} has an unsupported role`)
      continue
    }
    messages.push({ role: message.role, message })
  }

  return { messages, counts, skipped, invalid: false }
}

/**
 * Import one JSONL v3 session file into an open durable conversation as passive entries.
 *
 * A `write` submission per message keeps the history inert: it starts no generation and costs no
 * model call. Importing the same file twice appends the same messages again, so callers should
 * record which sessions were imported (the cutover slice owns that bookkeeping).
 */
export async function importSessionInto(
  conversation: {
    submit: (draft: { type: 'write'; entry: unknown }, context: unknown) => Promise<unknown>
  },
  filePath: string,
  context: unknown
): Promise<ImportResult> {
  const result = await importSessionFile(filePath)
  for (const message of result.messages) {
    const kind =
      message.role === 'assistant'
        ? 'pi.assistant'
        : message.role === 'user'
          ? 'pi.user'
          : undefined
    if (!kind) {
      result.skipped.push(`entry kind for role "${message.role}" has no durable equivalent`)
      continue
    }
    await conversation.submit({ type: 'write', entry: { kind, model: [message.message] } }, context)
  }
  return result
}
