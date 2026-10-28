import type { AssistantMessage, Message } from '@earendil-works/pi-ai'
import {
  createWireTranslator,
  type AgentEvent,
  type EntryRecord,
  type WireEvent,
  type WireOptions,
} from '../../electron/pi/durable/wire'
import { z } from 'zod'
import { sessionEventSchema } from '../../src/lib/ipc'

/**
 * Synthetic pi-durable events for the translator tests. Ids are type-level brands over `number`
 * (they carry no runtime tag), so a synthetic one needs a single assertion, kept here.
 */

type TaskIdOf<E> = E extends { taskId: infer T } ? T : never
type TaskId = TaskIdOf<Extract<AgentEvent, { type: 'compaction_end' }>>
type EntryId = EntryRecord['id']
type ConversationId = EntryRecord['conversationId']
type SubmissionId = Extract<AgentEvent, { type: 'submission' }>['record']['id']

// SAFETY: a branded id is exactly a number at runtime; the brand is compile-time only.
export const taskId = (n: number): TaskId => n as TaskId
// SAFETY: same reasoning as `taskId`.
export const entryId = (n: number): EntryId => n as EntryId
// SAFETY: same reasoning as `taskId`.
export const submissionId = (n: number): SubmissionId => n as SubmissionId
// SAFETY: same reasoning as `taskId`.
export const conversationId = (n: number): ConversationId => n as ConversationId

export const usage = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
}

export function assistant(text: string): AssistantMessage {
  return {
    role: 'assistant',
    content: text ? [{ type: 'text', text }] : [],
    api: 'faux',
    provider: 'faux',
    model: 'faux-1',
    usage,
    stopReason: 'stop',
    timestamp: 1_000,
  }
}

/** A `message_end` event whose entry carries `message`. */
export function messageEnd(message: Message): AgentEvent {
  const entry: EntryRecord = {
    id: entryId(1),
    conversationId: conversationId(1),
    kind: 'pi.assistant',
    model: [message],
  }
  return { type: 'message_end', entry }
}

export function translateAll(events: AgentEvent[], options?: WireOptions): WireEvent[] {
  const translate = createWireTranslator(options)
  return events.flatMap((event) => translate(event))
}

/** Every event must be one the renderer's own schema accepts; returns the failures. */
export function schemaFailures(events: readonly WireEvent[]): string[] {
  return events.flatMap((event) => {
    const parsed = sessionEventSchema.safeParse(event)
    return parsed.success
      ? []
      : [`${String(event.type)}: ${parsed.error.issues[0]?.message ?? '?'}`]
  })
}

const textDelta = z.object({
  type: z.literal('message_update'),
  assistantMessageEvent: z.object({ type: z.literal('text_delta'), delta: z.string() }),
})

/** The text of every `text_delta` update, in order. */
export function textDeltas(events: readonly WireEvent[]): string[] {
  return events.flatMap((event) => {
    const parsed = textDelta.safeParse(event)
    return parsed.success ? [parsed.data.assistantMessageEvent.delta] : []
  })
}

/** A `tool_execution_end` whose entry carries a finished tool-result message with `details`. */
export function toolEndWithDetails(
  toolCallId: string,
  details: Record<string, string>
): AgentEvent {
  const entry: EntryRecord = {
    id: entryId(2),
    conversationId: conversationId(1),
    kind: 'pi.toolResult',
    model: [
      {
        role: 'toolResult',
        toolCallId,
        toolName: 'task',
        content: [{ type: 'text', text: 'finished' }],
        details,
        isError: false,
        timestamp: 2_000,
      },
    ],
  }
  return { type: 'tool_execution_end', toolCallId, toolName: 'task', entry }
}
