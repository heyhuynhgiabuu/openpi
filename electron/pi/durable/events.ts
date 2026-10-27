import type { Context } from '@earendil-works/chord'
import type { AgentEvent, ConversationId, Harness } from '@earendil-works/pi-durable'
import { watchEvents } from '@earendil-works/pi-durable'
import { z } from 'zod'

/**
 * Phase 8.3d: durable agent events for the renderer.
 *
 * `watchEvents()` speaks pi-durable's vocabulary, which is *close to* but not the coding agent's:
 * a run is `run_start`/`run_end` there and `agent_start`/`agent_end` in the events the renderer
 * consumes (`src/lib/ipc/_full.ts`, `sessionEventPipe`). Those two names are translated here; every
 * other event already matches and passes through unchanged.
 *
 * Nested tool calls are included: the renderer's `isNestedToolEvent` guard suppresses the duplicate
 * cards they would otherwise produce for codemode/MCP calls.
 */

/** Minimal sink shape; the sidecar passes `send({ type: 'session_event', event })`. */
export interface EventSink {
  (event: Record<string, unknown>): void
}

export interface DurableEventsHandle {
  /** Detach from the conversation; safe to call twice. */
  stop: () => Promise<void>
}

/** Any event payload the renderer accepts: an object with a `type` discriminant. */
const wireEventSchema = z.object({ type: z.string() }).passthrough()

export type WireEvent = z.infer<typeof wireEventSchema>

/** pi-durable run boundaries -> the renderer's agent boundaries. */
const RUN_TO_AGENT: Readonly<Record<string, string>> = {
  run_start: 'agent_start',
  run_end: 'agent_end',
}

/**
 * Translate one durable event into the renderer's vocabulary and validate it.
 * Returns `undefined` for a payload the renderer could not read (no `type`).
 */
export function toWireEvent(event: AgentEvent | Record<string, unknown>): WireEvent | undefined {
  const parsed = wireEventSchema.safeParse(event)
  if (!parsed.success) return undefined
  const renamed = RUN_TO_AGENT[parsed.data.type]
  return renamed === undefined ? parsed.data : { ...parsed.data, type: renamed }
}

/**
 * Attach to a conversation and forward every event to `sink`.
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

  const forward = (event: AgentEvent | Record<string, unknown>): void => {
    if (stopped) return
    const wire = toWireEvent(event)
    if (wire) sink(wire)
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
