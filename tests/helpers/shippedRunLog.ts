/**
 * Reads the sidecar's forwarded session events as a compact run log, so a test
 * can assert the order Pi delivered things in without walking raw payloads.
 * Every event field read here is validated first: a malformed event fails with
 * its schema error instead of a silent mismatch.
 *
 * Labels (one per event that matters; message_update noise is dropped):
 *   agent_start | turn_start | turn_end | agent_end
 *   agent_settled aborted=<bool>
 *   user: <text>                         message_start of a user message
 *   assistant_start                      message_start of an assistant message
 *   assistant[<stopReason>]: <text>      message_end of an assistant message;
 *                                        tool calls read `toolCall <name>`
 *   toolResult: <text>                   message_end of a tool result
 *   custom: <text>                       message_start of an extension message
 *   tool_start <name> | tool_end <name>  (`tool_end <name> error` on failure)
 *   queue steer=<json> followUp=<json>   queue_update
 */
import { expect } from 'vitest'
import { z } from 'zod'
import type { SessionEvent } from './shippedReplies'

const contentPartSchema = z
  .object({ type: z.string(), text: z.string().optional(), name: z.string().optional() })
  .passthrough()
const contentSchema = z.union([z.string(), z.array(contentPartSchema)])
const messageSchema = z.object({
  role: z.string(),
  content: contentSchema.optional(),
  stopReason: z.string().optional(),
})

const messageEventSchema = z.object({ message: messageSchema })
const settledSchema = z.object({ aborted: z.boolean() })
const toolEventSchema = z.object({ toolName: z.string(), isError: z.boolean().optional() })
const queueSchema = z.object({ steering: z.array(z.string()), followUp: z.array(z.string()) })

function parseEvent<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, event: SessionEvent): T {
  const parsed = schema.safeParse(event)
  if (parsed.success) return parsed.data
  throw new Error(
    `malformed ${event.type} event: ${parsed.error.message}\nevent: ${JSON.stringify(event)}`
  )
}

/** Text of message content after its shape is validated by `contentSchema`. */
function textOfContent(content: z.infer<typeof contentSchema> | undefined): string {
  const text = z.string().safeParse(content)
  if (text.success) return text.data
  const parts = z.array(contentPartSchema).safeParse(content)
  if (!parts.success) return ''
  return parts.data.map((part) => (part.type === 'text' ? (part.text ?? '') : '')).join('')
}

/** Names of the tool calls in an assistant message's content blocks. */
function toolCallNames(content: z.infer<typeof contentSchema> | undefined): string[] {
  const parts = z.array(contentPartSchema).safeParse(content)
  if (!parts.success) return []
  return parts.data.flatMap((block) => {
    const parsed = z.object({ type: z.literal('toolCall'), name: z.string() }).safeParse(block)
    return parsed.success ? [parsed.data.name] : []
  })
}

function messageLabel(event: SessionEvent): string | null {
  const { message } = parseEvent(messageEventSchema, event)
  const text = textOfContent(message.content)
  if (event.type === 'message_start') {
    if (message.role === 'user') return `user: ${text}`
    if (message.role === 'assistant') return 'assistant_start'
    if (message.role === 'custom') return `custom: ${text}`
    return null
  }
  if (message.role === 'assistant') {
    const calls = toolCallNames(message.content).map((name) => `toolCall ${name}`)
    return `assistant[${message.stopReason ?? '?'}]: ${[text, ...calls].filter(Boolean).join(' ')}`
  }
  if (message.role === 'toolResult') return `toolResult: ${text}`
  return null
}

function eventLabel(event: SessionEvent): string | null {
  switch (event.type) {
    case 'agent_start':
    case 'turn_start':
    case 'turn_end':
    case 'agent_end':
      return event.type
    case 'agent_settled':
      return `agent_settled aborted=${parseEvent(settledSchema, event).aborted}`
    case 'message_start':
    case 'message_end':
      return messageLabel(event)
    case 'tool_execution_start':
      return `tool_start ${parseEvent(toolEventSchema, event).toolName}`
    case 'tool_execution_end': {
      const tool = parseEvent(toolEventSchema, event)
      return `tool_end ${tool.toolName}${tool.isError ? ' error' : ''}`
    }
    case 'queue_update': {
      const queue = parseEvent(queueSchema, event)
      return `queue steer=${JSON.stringify(queue.steering)} followUp=${JSON.stringify(queue.followUp)}`
    }
    default:
      return null
  }
}

/** The run log of `events` from index `since`, in arrival order. */
export function runLog(events: SessionEvent[], since = 0): string[] {
  return events.slice(since).flatMap((event) => {
    const label = eventLabel(event)
    return label === null ? [] : [label]
  })
}

/** True for the message_start of an assistant message: the provider call is open. */
export function isAssistantStart(event: SessionEvent): boolean {
  return event.type === 'message_start' && eventLabel(event) === 'assistant_start'
}

/** True for an event of `type`. */
export function isEvent(type: string): (event: SessionEvent) => boolean {
  return (event) => event.type === type
}

/** True for a custom (extension) message_start whose text starts with `prefix`. */
export function isCustomMessage(prefix: string): (event: SessionEvent) => boolean {
  return (event) => eventLabel(event)?.startsWith(`custom: ${prefix}`) ?? false
}

/** True for a tool_execution_start of `toolName`. */
export function isToolStart(toolName: string): (event: SessionEvent) => boolean {
  return (event) => eventLabel(event) === `tool_start ${toolName}`
}

/**
 * Asserts `expected` is a subsequence of `log`: each entry appears after the
 * one before it. Entries the test does not name may sit anywhere between.
 */
export function expectInOrder(log: string[], expected: string[]): void {
  let from = 0
  for (const entry of expected) {
    const index = log.indexOf(entry, from)
    expect(
      index,
      `'${entry}' after position ${from} in run log:\n${log.join('\n')}`
    ).toBeGreaterThan(-1)
    from = index + 1
  }
}

/** How many times `label` occurs in `log`. */
export function countOf(log: string[], label: string): number {
  return log.filter((entry) => entry === label).length
}
