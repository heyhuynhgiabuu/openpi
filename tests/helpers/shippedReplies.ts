/**
 * Zod schemas for the sidecar IPC messages the shipped-path harness reads.
 * Messages cross a process boundary, so each field a test reads is checked
 * first and a malformed reply fails with its schema error and raw payload.
 */
import { z } from 'zod'
import type { SidecarMessage } from '../../electron/pi/sidecarTypes'

/** A forwarded Pi session event: only `type` is guaranteed, the rest is per-event. */
export interface SessionEvent {
  type: string
  [key: string]: unknown
}

const sessionEventSchema: z.ZodType<SessionEvent, z.ZodTypeDef, unknown> = z
  .object({ type: z.string() })
  .passthrough()

const sessionEventMessage = z.object({
  type: z.literal('session_event'),
  event: sessionEventSchema,
})

export const sessionReadyReply = z.object({
  type: z.literal('session_ready'),
  payload: z.object({ sessionFile: z.string().nullable() }),
})

export const sessionInfoReply = z.object({
  type: z.literal('session_info_result'),
  info: z.object({
    messageCount: z.number(),
    model: z.object({ provider: z.string(), id: z.string() }).nullable(),
  }),
})

export const navigateTreeReply = z.object({
  type: z.literal('navigate_tree_result'),
  result: z.object({ cancelled: z.boolean(), leafId: z.string().nullable() }),
})

/** Validates one sidecar message against `schema`; throws with the payload on mismatch. */
export function parseReply<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  reply: SidecarMessage
): T {
  const parsed = schema.safeParse(reply)
  if (parsed.success) return parsed.data
  throw new Error(
    `malformed sidecar ${reply.type} message: ${parsed.error.message}\nmessage: ${JSON.stringify(reply)}`
  )
}

/** The forwarded session event inside a `session_event` message; throws if it is malformed. */
export function readSessionEvent(message: SidecarMessage): SessionEvent {
  return parseReply(sessionEventMessage, message).event
}
