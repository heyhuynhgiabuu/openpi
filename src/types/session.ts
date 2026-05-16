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

export type Message = SessionHistoryMessage | SystemMessage
export type SortMode = NonNullable<SessionListOptions['sortBy']>
export type GroupMode = NonNullable<SessionListOptions['groupBy']>

export type SessionGroup = {
  key: string
  label: string
  sessions: SessionListItem[]
}
