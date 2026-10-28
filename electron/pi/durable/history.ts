import type { Context } from '@earendil-works/chord'
import type { Conversation, EntryRecord } from '@earendil-works/pi-durable'

/**
 * A conversation's whole history, oldest first, fork-aware (a fork's own history starts with the
 * entries it shares with its parent).
 *
 * This is not `conversation.context()`: after a compaction the active context no longer holds the
 * entries before the cut, and exports and fork targets are resolved against the full history.
 */
export async function readHistory(
  conversation: Conversation,
  context: Context
): Promise<EntryRecord[]> {
  const history: EntryRecord[] = []
  let cursor: Awaited<ReturnType<Conversation['entries']>>['next']
  do {
    const page = await conversation.entries({ order: 'ascending' }, 200, cursor, context)
    history.push(...page.items)
    cursor = page.next
  } while (cursor !== undefined)
  return history
}
