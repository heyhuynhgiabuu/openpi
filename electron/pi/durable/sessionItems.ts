import type { Message } from '@earendil-works/pi-ai'
import { CompactionEntry } from '@earendil-works/pi-durable'
import type { EntryRecord } from '@earendil-works/pi-durable'
import { BRANCH_MARKER_TYPE } from '../../session/branchMarker'
import { BASH_KIND, bashRecordSchema } from './bash'
import type { SessionFileHeader } from './sessionFile'
import { sessionNameOf } from './stats'
import { messageText, unwrapSummary } from './text'

/** What one pi-durable entry becomes in the exported file: zero, one or several lines. */

/** Application entry written at the start of a navigated branch; the SDK ignores it as context. */
export const BRANCH_KIND = BRANCH_MARKER_TYPE

/** Lines one entry can become (a rename, a message, ...); the id keeps room for each. */
const LINES_PER_ENTRY = 8

/**
 * 8-char hex ids, the shape Pi's own entries use, derived from the pi-durable entry (one store-wide
 * counter) and the line's place within it, so an id never moves: not when a branch grows, not when
 * another branch appears, not across a reload.
 */
export function lineIdFor(source: EntryRecord['id'], ordinal: number): string {
  if (ordinal >= LINES_PER_ENTRY) throw new Error(`entry ${source} has too many lines to export`)
  return (Number(source) * LINES_PER_ENTRY + ordinal).toString(16).padStart(8, '0')
}

function messageTimestamp(message: Message, fallback: string): string {
  // An out-of-range number makes `toISOString()` throw, so check the Date, not just the number.
  const date = new Date(message.timestamp)
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString()
}

/** One line of the export, before ids are assigned. */
export interface Item {
  /** The pi-durable entry it came from, to resolve `head` references. */
  source: EntryRecord['id']
  type: 'message' | 'session_info' | 'compaction' | 'custom'
  timestamp: string
  body: Record<string, unknown>
  /** For a message: its role, which a synthetic renderer id also names. */
  role?: string
  /** For a user message: its text, which `navigate_tree` hands back for editing. */
  text?: string
  /** For a compaction: the pi-durable entry its summary keeps from. */
  keepFrom?: number
}

/** The raw summary inside pi-durable's wrapper, which is not part of what the SDK stores. */
function summaryOf(entry: EntryRecord): string {
  const text = messageText(entry.model?.[0]) ?? ''
  return unwrapSummary(text)
}

export function toItems(header: SessionFileHeader, entries: readonly EntryRecord[]): Item[] {
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
    if (entry.kind === BRANCH_KIND) {
      // Marks where a navigated branch starts, so the file's last line lies on the branch the
      // session is on even before it has a message of its own.
      items.push({
        source: entry.id,
        type: 'custom',
        timestamp: header.startedAt,
        body: { customType: BRANCH_KIND, data: entry.data ?? null },
      })
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
      const item: Item = {
        source: entry.id,
        type: 'message',
        role: message.role,
        timestamp: messageTimestamp(message, header.startedAt),
        body: { message },
      }
      if (message.role === 'user') item.text = messageText(message) ?? ''
      items.push(item)
    }
  }
  return items
}
