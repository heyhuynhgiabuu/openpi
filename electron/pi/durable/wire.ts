import type {
  AssistantMessage,
  AssistantMessageEvent,
  Message,
  ToolResultMessage,
} from '@earendil-works/pi-ai'
import type { AgentEvent, EntryRecord } from '@earendil-works/pi-durable'
import { createCompactionTracker } from './wireCompaction'
import { applyChange } from './wireMessage'

/**
 * Phase 8.3k: translate pi-durable agent events into the events the renderer reads.
 *
 * The two vocabularies share names but not shapes. The renderer (`sessionEventSchema`) needs, for
 * example, `agent_end.messages`, `turn_end.message`, `message_update.assistantMessageEvent` and
 * `message_end.message`; pi-durable emits `run_end.inputs`, a bare `turn_end`, `changes[]` and
 * `message_end.entry`. Most of these only fail the renderer's validation, so a session whose events
 * are merely passed through shows no assistant messages at all.
 *
 * The translator is stateful because several renderer fields are *accumulated* state: the partial
 * assistant message, the messages of a run and of a turn, a tool call's arguments and its output.
 * One event can become zero, one, or several renderer events.
 */

/** Re-exported so callers outside the adapter (tests) can type synthetic events without importing pi-durable. */
export type { AgentEvent, EntryRecord }

export type WireEvent = Record<string, unknown>

export interface WireOptions {
  /** Text of a queued submission by id (`inbox_update` carries only ids). */
  queuedText?: (submissionId: number) => string | undefined
  /** True once if the run that just ended was aborted by the user; reading it clears it. */
  consumeAborted?: () => boolean
}

/** The single model message an entry contributes, when it contributes one. */
function entryMessage(entry: EntryRecord | undefined): Message | undefined {
  return entry?.model?.[0]
}

interface ToolIdentity {
  toolCallId: string
  toolName: string
  parentToolCallId?: string
  parentTaskId?: number
}

/**
 * Envelope shared by the three tool events. `parentToolCallId` is what the renderer's
 * `isNestedToolEvent` keys on to hide the duplicate card of a nested call, on all three.
 */
function toolEnvelope(type: string, event: ToolIdentity): WireEvent {
  const envelope: WireEvent = { type, toolCallId: event.toolCallId, toolName: event.toolName }
  if (event.parentToolCallId !== undefined) envelope.parentToolCallId = event.parentToolCallId
  if (event.parentTaskId !== undefined) envelope.parentTaskId = event.parentTaskId
  return envelope
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value ?? '')
}

export function createWireTranslator(
  options: WireOptions = {}
): (event: AgentEvent) => WireEvent[] {
  let partial: AssistantMessage | undefined
  let runMessages: Message[] = []
  let turnAssistant: AssistantMessage | undefined
  let turnResults: ToolResultMessage[] = []
  // Text already sent as `text_delta`: the renderer builds an answer from deltas alone.
  let emittedText = ''
  const toolArgs = new Map<string, unknown>()
  const toolOutput = new Map<string, string>()
  let inboxPending = 0
  const compaction = createCompactionTracker()

  const remember = (message: Message): void => {
    runMessages.push(message)
    if (message.role === 'assistant') turnAssistant = message
    if (message.role === 'toolResult') turnResults.push(message)
  }

  return (event) => {
    switch (event.type) {
      case 'snapshot': {
        inboxPending = event.inbox.length
        partial = event.generation?.message
        // A snapshot can carry a run that was already live when the process died: the reopen hands
        // it back this way, and pi-durable only sends `run_start` when a run *changes*. Without
        // `agent_start` the app would show a run it never sees start, with no Stop button for work
        // that may already be touching the workspace.
        if (event.run === undefined) return []
        runMessages = []
        options.consumeAborted?.()
        return [{ type: 'agent_start' }]
      }
      case 'run_start':
        runMessages = []
        // An abort requested while idle must not mark the next run as aborted.
        options.consumeAborted?.()
        return [{ type: 'agent_start' }]
      case 'run_end': {
        const end: WireEvent = { type: 'agent_end', messages: runMessages, willRetry: false }
        runMessages = []
        // Settled = nothing queued behind this run; a queued follow-up starts the next one.
        if (inboxPending > 0) return [end]
        return [end, { type: 'agent_settled', aborted: options.consumeAborted?.() ?? false }]
      }
      case 'turn_start':
        turnAssistant = undefined
        turnResults = []
        return [{ type: 'turn_start' }]
      case 'turn_end':
        return turnAssistant
          ? [{ type: 'turn_end', message: turnAssistant, toolResults: turnResults }]
          : []
      case 'message_start':
        if (compaction.swallowStart(event.message)) return []
        if (event.message.role === 'assistant') emittedText = ''
        partial = event.message.role === 'assistant' ? event.message : partial
        return [{ type: 'message_start', message: event.message }]
      case 'message_update': {
        const out: WireEvent[] = []
        for (const change of event.changes) {
          if (!partial) break
          const applied = applyChange(partial, change)
          partial = applied.partial
          if (applied.event) {
            if (applied.event.type === 'text_delta') emittedText += applied.event.delta
            out.push({
              type: 'message_update',
              message: partial,
              assistantMessageEvent: applied.event,
            })
          }
        }
        return out
      }
      case 'message_end': {
        if (compaction.swallowEnd(event.entry)) return []
        const message = entryMessage(event.entry)
        if (!message) return []
        remember(message)
        const out: WireEvent[] = []
        if (message.role === 'assistant') {
          // A provider that does not stream sends the whole answer only here. Without a delta the
          // renderer would show an empty answer, so send what its deltas have not covered.
          const missing = missingText(message, emittedText)
          if (missing) out.push(missing)
          partial = undefined
        }
        out.push({ type: 'message_end', message })
        return out
      }
      case 'tool_execution_start': {
        toolArgs.set(event.toolCallId, event.args)
        const start = toolEnvelope('tool_execution_start', event)
        start.args = event.args
        return [start]
      }
      case 'tool_execution_update': {
        let output = toolOutput.get(event.toolCallId) ?? ''
        if (event.output && 'set' in event.output) output = event.output.set
        else if (event.output) {
          output = output.slice(event.output.trimStart ?? 0) + (event.output.append ?? '')
        }
        toolOutput.set(event.toolCallId, output)
        const update = toolEnvelope('tool_execution_update', event)
        update.args = toolArgs.get(event.toolCallId) ?? {}
        update.partialResult = {
          content: output ? [{ type: 'text', text: output }] : [],
          details: event.details,
        }
        // The renderer and the task tracker read `details` from the event itself, not the result.
        if (event.details !== undefined) update.details = event.details
        return [update]
      }
      case 'tool_execution_end': {
        toolArgs.delete(event.toolCallId)
        toolOutput.delete(event.toolCallId)
        const end = toolEnvelope('tool_execution_end', event)
        const message = entryMessage(event.entry)
        if (message?.role === 'toolResult') {
          end.result = { content: message.content, details: message.details }
          if (message.details !== undefined) end.details = message.details
          end.isError = message.isError
        } else if (event.result) {
          const structured = event.result.structuredOutput
          end.result = {
            content: structured === undefined ? [] : [{ type: 'text', text: textOf(structured) }],
            details: event.result.details,
          }
          if (event.result.details !== undefined) end.details = event.result.details
          end.isError = event.result.isError
        } else {
          // Faulted or orphaned: there is no result, but the card must still finish.
          end.result = { content: [] }
          end.isError = true
        }
        return [end]
      }
      case 'inbox_update':
        inboxPending = event.items.length
        return [queueUpdate(event.items, options.queuedText)]
      case 'auto_retry_start':
        // pi-durable does not report the attempt ceiling per event; the renderer needs a number.
        return [
          {
            type: 'auto_retry_start',
            attempt: event.attempt,
            maxAttempts: event.attempt,
            delayMs: Math.max(0, event.at - Date.now()),
            errorMessage: event.errorMessage,
          },
        ]
      case 'auto_retry_end':
        return [{ type: 'auto_retry_end', success: true, attempt: event.attempt }]
      case 'compaction_start':
        compaction.begin()
        return [{ type: 'compaction_start', reason: event.reason }]
      case 'compaction_end':
        return [compaction.end(event.reason, event.error)]
      case 'entry_appended':
        return [{ type: 'entry_appended', entry: event.entry }]
      case 'task_failed':
        return [
          {
            type: 'extension_error',
            extensionPath: 'pi-durable',
            event: event.kind,
            error: event.message,
          },
        ]
      case 'submission':
      case 'usage_changed':
      case 'agent_changed':
      case 'deferred_poll':
        return []
      default: {
        const unreachable: never = event
        return unreachable
      }
    }
  }
}

/** The `message_update` carrying answer text the deltas did not cover, or `undefined` if none. */
function missingText(message: AssistantMessage, emitted: string): WireEvent | undefined {
  const index = message.content.findIndex((block) => block.type === 'text')
  const full = message.content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('')
  // Only extend what was sent; if the deltas diverged from the final text, do not rewrite it.
  if (full.length <= emitted.length || !full.startsWith(emitted)) return undefined
  const delta = full.slice(emitted.length)
  const assistantMessageEvent: AssistantMessageEvent = {
    type: 'text_delta',
    contentIndex: Math.max(index, 0),
    delta,
    partial: message,
  }
  return { type: 'message_update', message, assistantMessageEvent }
}

function queueUpdate(
  items: readonly { id: number; mode: string }[],
  lookup: WireOptions['queuedText']
): WireEvent {
  const textOf = (id: number): string => lookup?.(id) ?? '(queued message)'
  return {
    type: 'queue_update',
    steering: items.filter((item) => item.mode === 'steer').map((item) => textOf(item.id)),
    followUp: items.filter((item) => item.mode === 'followUp').map((item) => textOf(item.id)),
  }
}
