import { z } from 'zod'

/**
 * Phase 8.4a: what a durable session's exported file says about the store behind it.
 *
 * A durable session keeps its real history in a pi-durable store; the JSONL file is the export the
 * sidebar reads. To resume one after a restart, the sidecar has to find that store again: its id
 * (the store is a directory named after it) and which conversations of it make up the session.
 *
 * Both are written on the `session` header line, under `openpi.durable`. They are additive fields:
 * a v3 file without them is a session the SDK path wrote (or one from before this slice), and the
 * SDK ignores what it does not read.
 */

export const DURABLE_HEADER_KEY = 'openpi.durable'

export const durableHeaderSchema = z
  .object({
    storeId: z.string().min(1),
    /** Conversations the session is made of, oldest branch first, the active one last. */
    conversationIds: z.array(z.number().int().positive()),
  })
  .strict()

export type DurableHeader = z.infer<typeof durableHeaderSchema>

const headerLine = z
  .object({
    type: z.literal('session'),
    version: z.literal(3),
    id: z.string().min(1),
    timestamp: z.string().optional(),
    cwd: z.string().optional(),
    [DURABLE_HEADER_KEY]: z.unknown().optional(),
  })
  .passthrough()

/** What a resume needs, read back from the file, or `undefined` when this is not a durable file. */
export interface ResumeTarget {
  sessionId: string
  startedAt: string
  storeId: string
  conversationIds: number[]
}

/**
 * Read the header of an exported session. `undefined` when the file is not a v3 header, has no
 * durable marker (an SDK session), or has one that does not parse - a session whose store cannot be
 * located has to be opened some other way, never guessed at.
 */
export function readResumeTarget(text: string): ResumeTarget | undefined {
  const first = text.split('\n', 1)[0] ?? ''
  let parsed: unknown
  try {
    parsed = JSON.parse(first)
  } catch {
    return undefined
  }
  const header = headerLine.safeParse(parsed)
  if (!header.success) return undefined
  const durable = durableHeaderSchema.safeParse(header.data[DURABLE_HEADER_KEY])
  if (!durable.success) return undefined
  const { id, timestamp } = header.data
  return {
    sessionId: id,
    // Same fallback the export uses when a session has no header time.
    startedAt: timestamp ?? new Date(0).toISOString(),
    storeId: durable.data.storeId,
    conversationIds: [...durable.data.conversationIds],
  }
}
