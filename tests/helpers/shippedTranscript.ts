/**
 * Read helpers for the shipped-path codemode tests: Pi's JSONL session tree and
 * the sidecar's forwarded session events. Pure functions over files and arrays,
 * so assertions stay in the test files.
 */
import fs from 'node:fs'
import type { SessionEvent } from './shippedSidecarHarness'

export type ToolEvent = {
  type: string
  toolName?: string
  toolCallId?: string
  parentToolCallId?: string
  args?: Record<string, unknown>
  isError?: boolean
}

/** One JSONL entry of a Pi session file, after the session header is dropped. */
export type TreeEntry = {
  type: string
  id?: string
  parentId?: string | null
  message?: Record<string, unknown>
}

/** Reads every non-header entry of a Pi session JSONL file, in file order. */
export function readSessionTree(sessionFile: string): TreeEntry[] {
  return fs
    .readFileSync(sessionFile, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((entry) => entry.type !== 'session') as TreeEntry[]
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
    .map((event) => contentToText((event.message as { content?: unknown } | undefined)?.content))
    .join(' | ')
}

export function toolEvents(events: SessionEvent[]): ToolEvent[] {
  return events as ToolEvent[]
}
