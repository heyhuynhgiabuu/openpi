import type { SessionHistoryMessage, SessionListItem, SessionListOptions } from '../lib/ipc'

export type ToolCard = SessionHistoryMessage['toolCards'][number]

/**
 * System message: surfaced for compaction and auto-retry events.
 * Never stored in the Pi JSONL — only lives in renderer state.
 */
export type SystemMessage = {
  id: string
  role: 'system'
  kind: 'compaction' | 'retry'
  text: string
  done: boolean
  // Compaction-specific — populated when kind === 'compaction' && done === true
  tokensBefore?: number
  reason?: 'manual' | 'threshold' | 'overflow'
  summary?: string
  readFiles?: string[]
  modifiedFiles?: string[]
}

/**
 * Extension command response (e.g. /fff-health). Renders as a distinct
 * response card in the conversation so it never gets confused with a
 * user-sent prompt or a code block in an assistant message.
 */
export type ExtensionResponseMessage = {
  id: string
  role: 'extension'
  text: string
  commandName: string
  level: 'info' | 'warn' | 'error'
  timestamp: number
}

export type Message = SessionHistoryMessage | SystemMessage | ExtensionResponseMessage
export type SortMode = NonNullable<SessionListOptions['sortBy']>
export type GroupMode = NonNullable<SessionListOptions['groupBy']>

export type SessionGroup = {
  key: string
  label: string
  sessions: SessionListItem[]
}
