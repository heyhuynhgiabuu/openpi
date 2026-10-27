import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createModels, fauxAssistantMessage, fauxProvider, fauxText } from '@earendil-works/pi-ai'
import type { ConversationId } from '@earendil-works/pi-durable'
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable'
import { describe, expect, it } from 'vitest'
import { attachDurableEvents } from '../electron/pi/durable/events'

/**
 * Phase 8.3d: the durable event feed carries the vocabulary the renderer already consumes, so tool
 * cards and streaming text work without a second renderer path.
 */

const ANSWER = 'durable streams this answer'

async function withHarness(
  run: (harness: Harness, conversationId: ConversationId) => Promise<void>
): Promise<void> {
  const faux = fauxProvider()
  faux.setResponses([fauxAssistantMessage([fauxText(ANSWER)], { stopReason: 'stop' as const })])
  const models = createModels()
  models.setProvider(faux.provider)
  const harness = await Harness.open(
    new MemoryStorage(),
    { models, registry: createRegistry() },
    BACKGROUND_CONTEXT
  )
  try {
    const root = await harness.root(BACKGROUND_CONTEXT, {
      agent: { model: { provider: faux.getModel().provider, modelId: faux.getModel().id } },
    })
    await run(harness, root.id)
  } finally {
    await harness.close(BACKGROUND_CONTEXT)
  }
}

describe('durable event bridge', () => {
  it('forwards an initial snapshot so a late attach can rebuild state', async () => {
    await withHarness(async (harness, conversationId) => {
      const seen: string[] = []
      const handle = await attachDurableEvents(
        harness,
        conversationId,
        BACKGROUND_CONTEXT,
        (event) => {
          seen.push(String(event.type))
        }
      )
      try {
        expect(seen[0]).toBe('snapshot')
      } finally {
        await handle.stop()
      }
    })
  })

  it('streams the renderer vocabulary for a run', async () => {
    await withHarness(async (harness, conversationId) => {
      const events: Record<string, unknown>[] = []
      const handle = await attachDurableEvents(
        harness,
        conversationId,
        BACKGROUND_CONTEXT,
        (event) => {
          events.push(event)
        }
      )
      try {
        const root = await harness.conversation(conversationId, BACKGROUND_CONTEXT)
        if (!root) throw new Error('conversation missing')
        const submission = await root.submit(
          { type: 'input', content: 'hello' },
          BACKGROUND_CONTEXT
        )
        await submission.wait(BACKGROUND_CONTEXT)

        const types = events.map((event) => String(event.type))
        // The events the renderer's tool cards, streaming text and turn accounting rely on.
        // `message_update` needs a token-by-token stream; the faux provider answers in one block,
        // so the message arrives through `message_start`/`message_end` instead.
        expect(types).toContain('run_start')
        expect(types).toContain('message_start')
        expect(types).toContain('message_end')
        expect(types).toContain('turn_start')
        expect(types).toContain('run_end')
        expect(JSON.stringify(events)).toContain(ANSWER)
      } finally {
        await handle.stop()
      }
    })
  })

  it('stops delivering after stop() and tolerates a second stop', async () => {
    await withHarness(async (harness, conversationId) => {
      const events: Record<string, unknown>[] = []
      const handle = await attachDurableEvents(
        harness,
        conversationId,
        BACKGROUND_CONTEXT,
        (event) => {
          events.push(event)
        }
      )
      await handle.stop()
      const afterStop = events.length
      await handle.stop()

      const root = await harness.conversation(conversationId, BACKGROUND_CONTEXT)
      if (!root) throw new Error('conversation missing')
      const submission = await root.submit({ type: 'input', content: 'later' }, BACKGROUND_CONTEXT)
      await submission.wait(BACKGROUND_CONTEXT)
      expect(events.length).toBe(afterStop)
    })
  })
})
