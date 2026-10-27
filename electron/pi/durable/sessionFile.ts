import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Message } from '@earendil-works/pi-ai'
import type { EntryRecord } from '@earendil-works/pi-durable'
import { z } from 'zod'

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

/** Pure: render a transcript as JSONL v3 text (one header line, then linear message entries). */
export function renderSessionJsonl(
  header: SessionFileHeader,
  entries: readonly EntryRecord[]
): { text: string; messages: number } {
  const lines: string[] = [
    JSON.stringify({
      type: 'session',
      version: 3,
      id: header.sessionId,
      timestamp: header.startedAt,
      cwd: header.cwd,
    }),
  ]
  let parentId: string | null = null
  let position = 0
  for (const entry of entries) {
    for (const message of entry.model ?? []) {
      position += 1
      const id = entryId(position)
      lines.push(
        JSON.stringify({
          type: 'message',
          id,
          parentId,
          timestamp: messageTimestamp(message, header.startedAt),
          message,
        })
      )
      parentId = id
    }
  }
  return { text: `${lines.join('\n')}\n`, messages: position }
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
