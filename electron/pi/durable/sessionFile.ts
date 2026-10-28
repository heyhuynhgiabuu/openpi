import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Message } from '@earendil-works/pi-ai'
import { CompactionEntry } from '@earendil-works/pi-durable'
import type { EntryRecord } from '@earendil-works/pi-durable'
import { z } from 'zod'
import { BASH_KIND, bashRecordSchema } from './bash'
import { sessionNameOf } from './stats'
import { messageText, unwrapSummary } from './text'

/**
 * Phase 8.3e: export a durable conversation as a Pi JSONL v3 session file.
 *
 * The sidebar, search and the importer all read JSONL v3, so the durable runtime keeps that file as
 * the interchange format instead of teaching every reader a second store. The export is a linear
 * transcript (the durable model has no parentId tree), written atomically, and deterministic: the
 * same entries always produce the same bytes, so re-exporting after each run is idempotent.
 *
 * It only ever overwrites a file it owns. A file whose header names another session is refused, so
 * an export can never clobber a session the SDK path wrote.
 */

export interface SessionFileHeader {
  /** Stable session id; also the ownership key for overwrites. */
  sessionId: string
  cwd: string
  /** ISO timestamp of the session start. */
  startedAt: string
}

export interface SessionFileResult {
  path: string
  /** Number of `message` entries written. */
  messages: number
}

// `version` is part of ownership: a v2 (or future) file with the same id is not ours to rewrite.
const headerLine = z
  .object({ type: z.literal('session'), version: z.literal(3), id: z.string() })
  .passthrough()

/** 8-char hex ids, the shape Pi's own entries use. Deterministic from the transcript position. */
function entryId(position: number): string {
  return position.toString(16).padStart(8, '0')
}

function messageTimestamp(message: Message, fallback: string): string {
  // An out-of-range number makes `toISOString()` throw, so check the Date, not just the number.
  const date = new Date(message.timestamp)
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString()
}

/** One line of the export, before ids are assigned. */
interface Item {
  /** The pi-durable entry it came from, to resolve `head` references. */
  source: EntryRecord['id']
  type: 'message' | 'session_info' | 'compaction'
  timestamp: string
  body: Record<string, unknown>
  /** For a message: its role, which a synthetic renderer id also names. */
  role?: string
  /** For a compaction: the pi-durable entry its summary keeps from. */
  keepFrom?: number
}

/** The raw summary inside pi-durable's wrapper, which is not part of what the SDK stores. */
function summaryOf(entry: EntryRecord): string {
  const text = messageText(entry.model?.[0]) ?? ''
  return unwrapSummary(text)
}

function toItems(header: SessionFileHeader, entries: readonly EntryRecord[]): Item[] {
  const items: Item[] = []
  for (const entry of entries) {
    const name = sessionNameOf(entry)
    if (name !== undefined) {
      items.push({
        source: entry.id,
        type: 'session_info',
        timestamp: header.startedAt,
        body: { name },
      })
    }
    if (CompactionEntry.is(entry)) {
      // The summary lives in the `compaction` line, as in SDK files; it is not also a message.
      const compaction: Item = {
        source: entry.id,
        type: 'compaction',
        timestamp: header.startedAt,
        body: { summary: summaryOf(entry), tokensBefore: 0 },
      }
      if (entry.head !== undefined) compaction.keepFrom = entry.head
      items.push(compaction)
      continue
    }
    const bash = bashRecordSchema.safeParse(entry.kind === BASH_KIND ? entry.data : undefined)
    if (bash.success) {
      // The SDK's own `bashExecution` message, so readers that know it (the sidebar, the SDK)
      // show the command; the model-visible copy on the entry is not also written.
      items.push({
        source: entry.id,
        type: 'message',
        timestamp: header.startedAt,
        role: 'bashExecution',
        body: { message: { role: 'bashExecution', ...bash.data } },
      })
      continue
    }
    for (const message of entry.model ?? []) {
      items.push({
        source: entry.id,
        type: 'message',
        role: message.role,
        timestamp: messageTimestamp(message, header.startedAt),
        body: { message },
      })
    }
  }
  return items
}

/**
 * Pure: render a transcript as JSONL v3 text (one header line, then a linear chain of entries).
 *
 * `entries` must be the conversation's **whole history**, not the active context: after a compaction
 * the active context drops everything before the cut, and writing only that would erase it from the
 * file. A compaction becomes an SDK-style `compaction` line, so a reader that rebuilds context
 * (the SDK does) gets the same compacted context pi-durable has, while the history stays on disk.
 */
export function renderSessionJsonl(
  header: SessionFileHeader,
  entries: readonly EntryRecord[]
): { text: string; messages: number } {
  const items = toItems(header, entries)
  const ids = items.map((_, index) => entryId(index + 1))
  const lines: string[] = [
    JSON.stringify({
      type: 'session',
      version: 3,
      id: header.sessionId,
      timestamp: header.startedAt,
      cwd: header.cwd,
    }),
  ]
  items.forEach((item, index) => {
    const id = ids[index] ?? entryId(index + 1)
    const body = { ...item.body }
    if (item.type === 'compaction') {
      // The first kept entry's line; `head` may name an entry that wrote no line, so take the next
      // one that did. With none, the compaction keeps nothing and names itself, as the SDK does.
      const kept = items.findIndex((candidate) => candidate.source >= (item.keepFrom ?? Infinity))
      body.firstKeptEntryId = kept === -1 ? id : (ids[kept] ?? id)
    }
    lines.push(
      JSON.stringify({
        type: item.type,
        id,
        parentId: index === 0 ? null : (ids[index - 1] ?? null),
        timestamp: item.timestamp,
        ...body,
      })
    )
  })
  return {
    text: `${lines.join('\n')}\n`,
    messages: items.filter((item) => item.type === 'message').length,
  }
}

/**
 * The pi-durable entry behind an exported line, from the id the sidebar and renderer know it by.
 *
 * Line ids are positional and deterministic, so re-rendering the same history yields the ids the
 * file has. The renderer only knows a message by a synthetic id (`u-{ms}` / `a-{ms}`: role and
 * timestamp) until it next reads the file, which is every message of the current session; those
 * are matched on role and timestamp. Two messages of one role can share a timestamp (pi-durable
 * places a steer and a follow-up in one commit), and then the id does not say which is meant: that
 * is an error, never a guess.
 */
export function resolveLineEntry(
  header: SessionFileHeader,
  entries: readonly EntryRecord[],
  lineId: string
): EntryRecord['id'] | undefined {
  const items = toItems(header, entries)
  const index = items.findIndex((_, position) => entryId(position + 1) === lineId)
  if (index >= 0) return items[index]?.source
  const synthetic = /^[ua]-(-?\d+)$/.exec(lineId)
  if (!synthetic) return undefined
  const at = Number(synthetic[1])
  const role = lineId.startsWith('u') ? 'user' : 'assistant'
  const matches = items.filter((item) => item.role === role && Date.parse(item.timestamp) === at)
  if (matches.length > 1) {
    throw new Error(
      `Cannot fork: ${lineId} is ambiguous, ${matches.length} ${role} messages were sent at the same moment`
    )
  }
  return matches[0]?.source
}

/** Header id of an existing file, or undefined when it is empty or not a v3 session. */
async function existingSessionId(path: string): Promise<string | undefined> {
  if (!existsSync(path)) return undefined
  try {
    const first = (await readFile(path, 'utf8')).split('\n', 1)[0] ?? ''
    const parsed = headerLine.safeParse(JSON.parse(first))
    return parsed.success ? parsed.data.id : undefined
  } catch {
    // Unreadable (a directory, a permission error) or not JSON: not a session we own.
    return undefined
  }
}

/** The one filesystem step a test needs to fail on demand; production always uses the real one. */
export interface SessionFileIo {
  rename: (from: string, to: string) => Promise<void>
}

/** Exports to the same destination run one at a time, so check-then-rename cannot interleave. */
const pendingByPath = new Map<string, Promise<unknown>>()

async function writeOnce(
  path: string,
  header: SessionFileHeader,
  entries: readonly EntryRecord[],
  io: SessionFileIo
): Promise<SessionFileResult> {
  if (existsSync(path)) {
    const owner = await existingSessionId(path)
    if (owner !== header.sessionId) {
      throw new Error(`refusing to overwrite ${path}: it belongs to another session`)
    }
  }
  const { text, messages } = renderSessionJsonl(header, entries)
  await mkdir(dirname(path), { recursive: true })
  // Unique per call: even a stray overlap can never share a temp file.
  const temp = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temp, text, 'utf8')
    await io.rename(temp, path)
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
  return { path, messages }
}

/** Write the transcript atomically (temp file + rename); refuse to overwrite a foreign file. */
export function writeSessionFile(
  path: string,
  header: SessionFileHeader,
  entries: readonly EntryRecord[],
  io: SessionFileIo = { rename }
): Promise<SessionFileResult> {
  const previous = pendingByPath.get(path) ?? Promise.resolve()
  // A failed earlier export must not block the next one.
  const run = previous.catch(() => undefined).then(() => writeOnce(path, header, entries, io))
  const tail = run.catch(() => undefined)
  pendingByPath.set(path, tail)
  void tail.then(() => {
    if (pendingByPath.get(path) === tail) pendingByPath.delete(path)
  })
  return run
}
