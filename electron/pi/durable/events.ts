import type { Context } from '@earendil-works/chord'
import type { AgentEvent, ConversationId, Harness } from '@earendil-works/pi-durable'
import { watchEvents } from '@earendil-works/pi-durable'
import { createWireTranslator, type WireEvent, type WireOptions } from './wire'

/**
 * Phase 8.3d: durable agent events for the renderer.
 *
 * `watchEvents()` speaks pi-durable's vocabulary, which shares names with the coding agent's but
 * not shapes (see `wire.ts`). Each event is translated into the renderer's before it reaches the
 * sink, which is what the sidecar sends as `session_event`.
 */

/** Minimal sink shape; the sidecar passes `send({ type: 'session_event', event })`. */
export interface EventSink {
  (event: WireEvent): void
}

export interface DurableEventsHandle {
  /** Detach from the conversation; safe to call twice. */
  stop: () => Promise<void>
}

/**
 * Attach to a conversation and forward every translated event to `sink`.
 *
 * The initial `snapshot` is fed to the translator too: it seeds the in-flight message and the queue
 * depth, so attaching mid-run still produces coherent `message_update`s and `agent_settled`.
 */
export async function attachDurableEvents(
  harness: Harness,
  conversationId: ConversationId,
  context: Context,
  sink: EventSink,
  options: WireOptions = {}
): Promise<DurableEventsHandle> {
  const stream = await watchEvents(harness, conversationId, context)
  const translate = createWireTranslator(options)
  let stopped = false

  const forward = (event: AgentEvent): void => {
    if (stopped) return
    for (const wire of translate(event)) sink(wire)
  }

  forward(stream.snapshot)
  stream.start(async (events: readonly AgentEvent[]) => {
    if (stopped) return
    for (const event of events) forward(event)
  })

  return {
    async stop(): Promise<void> {
      if (stopped) return
      stopped = true
      await stream.stop()
    },
  }
}
