import type { Context } from '@earendil-works/chord'
import type { AgentEvent, Harness } from '@earendil-works/pi-durable'
import { watchEvents } from '@earendil-works/pi-durable'
import type { ConversationId } from '@earendil-works/pi-durable'

/**
 * Phase 8.3d: durable agent events for the renderer.
 *
 * `watchEvents()` already emits the coding agent's event vocabulary (`message_update` with deltas,
 * `tool_execution_start/update/end`, `turn_start/end`, `inbox_update`, `auto_retry_*`,
 * `compaction_*`), which is exactly what the renderer's session-event consumers understand. This
 * module attaches that stream to a conversation and hands each batch to a sink, so the durable
 * runtime can feed the existing tool cards and streaming UI without a parallel renderer path.
 *
 * Nested tool calls are included: the renderer's `isNestedToolEvent` guard already suppresses the
 * duplicate cards that would otherwise appear for codemode/MCP calls.
 */

/** Minimal sink shape; the sidecar passes `send({ type: 'session_event', event })`. */
export interface EventSink {
  (event: Record<string, unknown>): void
}

export interface DurableEventsHandle {
  /** Detach from the conversation; safe to call twice. */
  stop: () => Promise<void>
}

/**
 * Attach to a conversation and forward every event batch to `sink`.
 *
 * The initial `snapshot` is forwarded too: the renderer uses it to rebuild in-flight state (a
 * partial answer, running tool cards) when it attaches mid-run, which a delta-only feed cannot do.
 */
export async function attachDurableEvents(
  harness: Harness,
  conversationId: ConversationId,
  context: Context,
  sink: EventSink
): Promise<DurableEventsHandle> {
  const stream = await watchEvents(harness, conversationId, context)
  let stopped = false
  let stopPromise: Promise<unknown> | undefined

  const stop = async (): Promise<void> => {
    if (stopped) return
    stopped = true
    stopPromise = stream.stop()
    await stopPromise
  }

  sink(stream.snapshot as unknown as Record<string, unknown>)
  stream.start(async (events: readonly AgentEvent[]) => {
    if (stopped) return
    for (const event of events) {
      sink(event as unknown as Record<string, unknown>)
    }
  })

  return { stop }
}
