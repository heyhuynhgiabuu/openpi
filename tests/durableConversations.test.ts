import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createModels, fauxProvider } from '@earendil-works/pi-ai'
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable'
import { describe, expect, it } from 'vitest'
import { listDurableConversations } from '../electron/pi/durable/conversations'

/**
 * Phase 8.2e: the session index reads the durable store directly, so the sidebar can list
 * conversations without opening them and without the Pi SDK.
 */

async function withStore(
  run: (storage: MemoryStorage, harness: Harness) => Promise<void>
): Promise<void> {
  const faux = fauxProvider()
  const models = createModels()
  models.setProvider(faux.provider)
  const storage = new MemoryStorage()
  const harness = await Harness.open(
    storage,
    { models, registry: createRegistry() },
    BACKGROUND_CONTEXT
  )
  try {
    await run(storage, harness)
  } finally {
    await harness.close(BACKGROUND_CONTEXT)
  }
}

describe('durable conversation index', () => {
  it('lists the root conversation and created ones', async () => {
    await withStore(async (storage, harness) => {
      await harness.root(BACKGROUND_CONTEXT)
      await harness.createConversation({ ownership: { kind: 'ownerless' } }, BACKGROUND_CONTEXT)
      const page = await listDurableConversations(storage, { limit: 10 }, BACKGROUND_CONTEXT)
      expect(page.items.length).toBe(2)
      // Newest first, and ids are the store's numeric conversation ids.
      expect(page.items[0].id).toBeGreaterThan(page.items[1].id)
      expect(page.items.every((item) => item.parentId === null)).toBe(true)
    })
  })

  it('records the fork parent and the entry it forked at', async () => {
    await withStore(async (storage, harness) => {
      const root = await harness.root(BACKGROUND_CONTEXT)
      const view = await root.context(BACKGROUND_CONTEXT)
      const submission = await root.submit(
        { type: 'write', entry: { kind: 'pi.user', model: [] } },
        BACKGROUND_CONTEXT
      )
      await submission.wait(BACKGROUND_CONTEXT)
      const after = await root.context(BACKGROUND_CONTEXT)
      const target = after.entries.at(-1) ?? view.entries.at(-1)
      if (!target) throw new Error('no entry to fork at')
      await root.fork(target.id, { ownership: { kind: 'ownerless' } }, BACKGROUND_CONTEXT)

      const page = await listDurableConversations(storage, { limit: 10 }, BACKGROUND_CONTEXT)
      const forked = page.items.find((item) => item.parentId !== null)
      expect(forked).toBeDefined()
      expect(forked?.parentId).toBe(Number(root.id))
      expect(forked?.forkedAt).toBe(Number(target.id))
    })
  })

  it('paginates with the returned cursor and can order ascending', async () => {
    await withStore(async (storage, harness) => {
      await harness.root(BACKGROUND_CONTEXT)
      await harness.createConversation({ ownership: { kind: 'ownerless' } }, BACKGROUND_CONTEXT)
      await harness.createConversation({ ownership: { kind: 'ownerless' } }, BACKGROUND_CONTEXT)

      const first = await listDurableConversations(storage, { limit: 2 }, BACKGROUND_CONTEXT)
      expect(first.items).toHaveLength(2)
      expect(first.cursor).toBeDefined()
      const second = await listDurableConversations(
        storage,
        { limit: 2, cursor: first.cursor },
        BACKGROUND_CONTEXT
      )
      expect(second.items).toHaveLength(1)
      expect(second.cursor).toBeUndefined()

      const ascending = await listDurableConversations(
        storage,
        { limit: 10, newestFirst: false },
        BACKGROUND_CONTEXT
      )
      expect(ascending.items[0].id).toBeLessThan(ascending.items.at(-1)?.id ?? 0)
    })
  })
})
