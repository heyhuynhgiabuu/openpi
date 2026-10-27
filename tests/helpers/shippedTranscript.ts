/**
 * Read helpers for the shipped-path codemode tests: Pi's JSONL session tree and
 * the sidecar's forwarded session events. Pure functions over files and arrays,
 * so assertions stay in the test files. Everything read from disk or from the
 * child is validated before use, so malformed data fails with a clear message.
 */
import fs from 'node:fs'
import { z } from 'zod'
import type { SessionEvent } from './shippedReplies'

export interface ToolEvent extends SessionEvent {
  toolName?: string
  toolCallId?: string
  parentToolCallId?: string
  args?: Record<string, unknown>
  isError?: boolean
}

/** One JSONL entry of a Pi session file, after the session header is dropped. */
export interface TreeEntry {
  type: string
  id?: string
  parentId?: string | null
  message?: Record<string, unknown>
}

const toolEventSchema = z.object({
  type: z.string(),
  toolName: z.string().optional(),
  toolCallId: z.string().optional(),
  parentToolCallId: z.string().optional(),
  args: z.record(z.unknown()).optional(),
  isError: z.boolean().optional(),
})

const treeEntrySchema = z.object({
  type: z.string(),
  id: z.string().optional(),
  parentId: z.string().nullable().optional(),
  message: z.record(z.unknown()).optional(),
})

const messageEndSchema = z.object({
  message: z.object({ content: z.unknown() }).optional(),
})

function parseTreeLine(sessionFile: string, line: string, index: number): TreeEntry {
  const where = `${sessionFile}:${index + 1}`
  let json: unknown
  try {
    json = JSON.parse(line)
  } catch (error) {
    throw new Error(`${where}: session entry is not valid JSON (${String(error)})`)
  }
  const parsed = treeEntrySchema.safeParse(json)
  if (!parsed.success) throw new Error(`${where}: malformed session entry: ${parsed.error.message}`)
  return parsed.data
}

/** Reads every non-header entry of a Pi session JSONL file, in file order. */
export function readSessionTree(sessionFile: string): TreeEntry[] {
  return fs
    .readFileSync(sessionFile, 'utf8')
    .trim()
    .split('\n')
    .map((line, index) => parseTreeLine(sessionFile, line, index))
    .filter((entry) => entry.type !== 'session')
}

/** Text of a message content field: a plain string, or the text parts of a block list. */
export function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) =>
      part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string'
        ? part.text
        : ''
    )
    .join('')
}

/** Concatenated text of every message_end event, as the provider answered them. */
export function answeredText(events: SessionEvent[]): string {
  return events
    .filter((event) => event.type === 'message_end')
    .map((event) => {
      const parsed = messageEndSchema.safeParse(event)
      if (!parsed.success) throw new Error(`malformed message_end event: ${parsed.error.message}`)
      return contentToText(parsed.data.message?.content)
    })
    .join(' | ')
}

/**
 * Validates every event's tool fields and returns the same objects (identity is
 * kept, so callers can still locate them in the harness event list).
 */
export function toolEvents(events: SessionEvent[]): ToolEvent[] {
  return events.filter((event): event is ToolEvent => {
    const parsed = toolEventSchema.safeParse(event)
    if (!parsed.success) {
      throw new Error(`malformed ${event.type} event: ${parsed.error.message}`)
    }
    return true
  })
}
