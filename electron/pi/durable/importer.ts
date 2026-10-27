import type { Context } from '@earendil-works/chord'
import { createReadStream, existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import type { Message } from '@earendil-works/pi-ai'
import type { Conversation } from '@earendil-works/pi-durable'
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

const textPart = z.object({ type: z.literal('text'), text: z.string() }).passthrough()
// Images and other provider parts must survive: rejecting them would drop the whole message,
// including its text, so any well-formed part is accepted here.
const imagePart = z
  .object({ type: z.literal('image'), data: z.string(), mimeType: z.string() })
  .passthrough()
const anyPart = z.object({ type: z.string() }).passthrough()
const userContent = z.union([
  z.string().min(1),
  z.array(z.union([textPart, imagePart, anyPart])).min(1),
])

/**
 * Validate the message payloads the importer accepts, keyed by role. Content must be present and
 * non-empty: `{ "role": "user" }` alone is a malformed line, not a message.
 */
const messageSchemas = {
  user: z.object({ role: z.literal('user'), content: userContent }).passthrough(),
  system: z.object({ role: z.literal('system'), content: userContent }).passthrough(),
  assistant: z
    .object({ role: z.literal('assistant'), content: z.array(anyPart).min(1) })
    .passthrough(),
  toolResult: z
    .object({ role: z.literal('toolResult'), content: z.union([z.string(), z.array(anyPart)]) })
    .passthrough(),
} as const

/** Own-key lookup: `role: "constructor"` must not reach `Object.prototype`. */
function schemaFor(role: string): (typeof messageSchemas)[keyof typeof messageSchemas] | undefined {
  if (!Object.hasOwn(messageSchemas, role)) return undefined
  return messageSchemas[role as keyof typeof messageSchemas]
}

/** Validate an unknown JSONL `message` payload against the role it claims to have. */
function asMessage(value: unknown): Message | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const role = z.object({ role: z.string() }).passthrough().safeParse(value)
  if (!role.success) return undefined
  const schema = schemaFor(role.data.role)
  if (!schema) return undefined
  const parsed = schema.safeParse(value)
  if (!parsed.success) return undefined
  // SAFETY: the four schemas encode the pi-ai message contracts for role and content (validated
  // above, unknown roles rejected) and `.passthrough()` preserves the remaining provider fields.
  return parsed.data as unknown as Message
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

  // Walk from the last entry (the leaf) back to the root through parentId, reporting a chain that
  // ends early so a caller can tell a complete import from a truncated one.
  const chain: string[] = []
  let cursor = order.at(-1)
  const seen = new Set<string>()
  let cycle = false
  while (cursor !== undefined) {
    if (seen.has(cursor)) {
      cycle = true
      skipped.push(`cycle in parentId chain at entry ${cursor}`)
      break
    }
    seen.add(cursor)
    chain.push(cursor)
    const parsed = looseEntry.safeParse(byId.get(cursor))
    if (!parsed.success) {
      skipped.push(`entry ${cursor} is unreadable; history before it is missing`)
      break
    }
    const parent = parsed.data.parentId
    if (parent !== null && parent !== undefined && !byId.has(parent)) {
      skipped.push(`entry ${cursor} names missing parent ${parent}; history before it is missing`)
      break
    }
    cursor = parent ?? undefined
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
  conversation: Conversation,
  filePath: string,
  context: Context
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
