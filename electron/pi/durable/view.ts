import { AssistantEntry } from '@earendil-works/pi-durable'
import type { EntryRecord } from '@earendil-works/pi-durable'
import { messageText } from './text'
import type { DurableEntrySnapshot, DurableView } from './types'

/** Structural views of a conversation's entries, for the host. */

function entrySnapshot(record: EntryRecord): DurableEntrySnapshot {
  const snapshot: DurableEntrySnapshot = { id: record.id, kind: record.kind }
  const text = messageText(record.model?.[0])
  if (text !== undefined && text !== '') snapshot.text = text
  return snapshot
}

export function toView(conversationId: number, records: readonly EntryRecord[]): DurableView {
  return { conversationId, entries: records.map(entrySnapshot) }
}

/** Text of the final assistant answer, resolved from the settled submission's answer entry ID. */
export function answerText(
  records: readonly EntryRecord[],
  answerId: number | undefined
): string | undefined {
  if (answerId === undefined) return undefined
  const record = records.find((candidate) => candidate.id === answerId)
  if (!record || !AssistantEntry.is(record)) return undefined
  return messageText(record.model?.[0])
}
