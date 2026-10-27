import type { Context } from '@earendil-works/chord'
import type { ConversationRecord, Storage } from '@earendil-works/pi-durable'
import { z } from 'zod'

/**
 * Phase 8.2e: a session index over the durable store.
 *
 * The sidebar needs a list of conversations without opening each one. `Storage.scanConversations`
 * is the read side (the `Session` exposes it only through `Storage`); this module turns pages of `ConversationRecord` into the Zod-validated summary
 * rows the existing index/IPC layer already speaks. No writes happen here, and no Pi SDK types are
 * involved, so the durable runtime can serve the index while the SDK path keeps serving sessions.
 */

export const durableConversationSummarySchema = z.object({
  id: z.number().int().nonnegative(),
  /** Fork parent, when this conversation came from one. */
  parentId: z.number().int().nonnegative().nullable(),
  /** Entry the fork started at, when known. */
  forkedAt: z.number().int().nonnegative().nullable(),
})

export type DurableConversationSummary = z.infer<typeof durableConversationSummarySchema>

/** One page of conversation summaries plus the cursor for the next page. */
export interface DurableConversationPage {
  items: DurableConversationSummary[]
  /** Pass back to `listDurableConversations` to continue; `undefined` when the page was the last. */
  cursor: unknown
}

function toSummary(record: ConversationRecord): DurableConversationSummary {
  return durableConversationSummarySchema.parse({
    id: Number(record.id),
    parentId: record.parent === undefined ? null : Number(record.parent.conversationId),
    forkedAt: record.parent === undefined ? null : Number(record.parent.at),
  })
}

/**
 * List durable conversations, newest first.
 *
 * `limit` bounds one page; callers pass `cursor` back to continue. Records are validated on the way
 * out so a store written by a newer pi-durable cannot leak an unexpected shape into the renderer.
 */
export async function listDurableConversations(
  storage: Storage,
  options: { limit: number; cursor?: unknown; newestFirst?: boolean },
  context: Context
): Promise<DurableConversationPage> {
  const page = await storage.scanConversations(
    { order: options.newestFirst === false ? 'ascending' : 'descending' },
    options.limit,
    options.cursor as never,
    context
  )
  return {
    items: page.items.map(toSummary),
    cursor: page.next ?? undefined,
  }
}
