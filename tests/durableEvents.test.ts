import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createModels, fauxAssistantMessage, fauxProvider, fauxText } from '@earendil-works/pi-ai'
import type { ConversationId } from '@earendil-works/pi-durable'
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable'
import { describe, expect, it } from 'vitest'
import { attachDurableEvents, toWireEvent } from '../electron/pi/durable/events'

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
        // The renderer's vocabulary, not pi-durable's: it starts and ends runs on
        // `agent_start`/`agent_end` (src/lib/ipc/_full.ts, sessionEventPipe), never on `run_*`.
        // `message_update` needs a token-by-token stream and the faux provider answers in one
        // block, so the message arrives through `message_start`/`message_end` here.
        expect(types).toContain('agent_start')
        expect(types).toContain('agent_end')
        expect(types).not.toContain('run_start')
        expect(types).not.toContain('run_end')
        expect(types).toContain('message_start')
        expect(types).toContain('message_end')
        expect(types).toContain('turn_start')
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

describe('durable event translation', () => {
  it('renames run boundaries to the renderer agent boundaries', () => {
    expect(toWireEvent({ type: 'run_start' })?.type).toBe('agent_start')
    expect(toWireEvent({ type: 'run_end' })?.type).toBe('agent_end')
  })

  it('passes every other event through unchanged', () => {
    expect(toWireEvent({ type: 'turn_start' })?.type).toBe('turn_start')
    expect(toWireEvent({ type: 'tool_execution_start', toolName: 'bash' })).toMatchObject({
      type: 'tool_execution_start',
      toolName: 'bash',
    })
  })

  it('drops a payload the renderer could not read', () => {
    expect(toWireEvent({})).toBeUndefined()
    expect(toWireEvent({ type: 42 })).toBeUndefined()
  })
})

describe('durable queue translation', () => {
  const texts = new Map([
    [1, 'steer me'],
    [2, 'then follow up'],
  ])
  const lookup = (id: number) => texts.get(id)

  it('turns inbox_update into the renderer queue_update with message text', () => {
    const wire = toWireEvent(
      {
        type: 'inbox_update',
        items: [
          { id: 1, mode: 'steer' },
          { id: 2, mode: 'followUp' },
        ],
      },
      lookup
    )
    expect(wire).toEqual({
      type: 'queue_update',
      steering: ['steer me'],
      followUp: ['then follow up'],
    })
  })

  it('clears both lists when the inbox empties', () => {
    expect(toWireEvent({ type: 'inbox_update', items: [] }, lookup)).toEqual({
      type: 'queue_update',
      steering: [],
      followUp: [],
    })
  })

  it('labels a message whose text is unknown instead of dropping it', () => {
    const wire = toWireEvent({ type: 'inbox_update', items: [{ id: 99, mode: 'steer' }] }, lookup)
    expect(wire).toMatchObject({ steering: ['(queued message)'], followUp: [] })
  })

  it('does not show passive writes as pending messages', () => {
    const wire = toWireEvent({ type: 'inbox_update', items: [{ id: 3, mode: 'write' }] }, lookup)
    expect(wire).toMatchObject({ steering: [], followUp: [] })
  })

  it('leaves a malformed inbox_update to the generic path rather than crashing', () => {
    expect(toWireEvent({ type: 'inbox_update', items: 'nope' }, lookup)).toMatchObject({
      type: 'inbox_update',
    })
  })
})
