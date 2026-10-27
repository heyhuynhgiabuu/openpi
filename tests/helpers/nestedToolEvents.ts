/**
 * Realistic Pi codemode nested-call data for renderer tests. The shapes mirror
 * what tests/shippedPathCodemode.test.ts observes from the real sidecar: the
 * model-issued `codemode` call, its script's nested `tools.write` call (child id
 * `<callId>/<n>`, every child event carries `parentToolCallId`), the Pi 1.1+
 * `durationMs` on `tool_execution_end`, and the `nestedCalls` record Pi persists
 * on the codemode toolResult message. Events pass through the real
 * `sessionEventSchema`, the way the main process parses them before forwarding.
 */
import { z } from 'zod'
import type { SessionEntry } from '../../electron/session/sessionEntries'
import { sessionEventSchema, type SessionEvent } from '../../src/lib/ipc'

export const CODEMODE_CALL_ID = 'scripted-codemode-1'
export const NESTED_CALL_ID = `${CODEMODE_CALL_ID}/1`
export const NESTED_FILE_PATH = 'nested.txt'
export const NESTED_FILE_CONTENT = 'nested via codemode\n'
export const CODEMODE_SCRIPT = `return await tools.write({ path: ${JSON.stringify(NESTED_FILE_PATH)}, content: ${JSON.stringify(NESTED_FILE_CONTENT)} })`
export const CODEMODE_RESULT_HEADER = 'Script completed\nWall time 0.0 seconds\nOutput:\n'
export const CODEMODE_RESULT_TEXT = `${CODEMODE_RESULT_HEADER}Successfully wrote 20 bytes to ${NESTED_FILE_PATH}`
export const FINAL_TEXT = 'scripted codemode done'

type RawEvent = Record<string, unknown>

/** Parses raw sidecar events through the renderer's session event schema. */
export function parseEvents(raw: RawEvent[]): SessionEvent[] {
  return raw.map((event) => sessionEventSchema.parse(event))
}

const messageEnvelopeSchema = z.object({ message: z.object({ role: z.string() }) })

/** Role of the `message` an event carries, or undefined for events without one. */
export function messageRoleOf(event: SessionEvent): string | undefined {
  const parsed = messageEnvelopeSchema.safeParse(event)
  return parsed.success ? parsed.data.message.role : undefined
}

/** The nested record Pi stores for one `write` call: name, arguments, status, never results. */
export function nestedCallsRecord(callId: string) {
  return {
    calls: [
      {
        id: `${callId}/1`,
        name: 'write',
        status: 'ok',
        durationMs: 3,
        arguments: { path: NESTED_FILE_PATH, content: NESTED_FILE_CONTENT },
      },
    ],
    complete: true,
  }
}

/** Raw tool events of one codemode call that makes one nested `write`, in Pi's order. */
export function codemodeToolEvents(callId = CODEMODE_CALL_ID) {
  const childId = `${callId}/1`
  const args = { code: CODEMODE_SCRIPT }
  const progress = (calls: RawEvent[]) => ({
    type: 'tool_execution_update',
    toolCallId: callId,
    toolName: 'codemode',
    args,
    partialResult: { content: [], details: { calls } },
  })
  const childCall = { id: childId, name: 'write', status: 'ok' }
  return {
    start: { type: 'tool_execution_start', toolCallId: callId, toolName: 'codemode', args },
    running: progress([]),
    nestedStart: {
      type: 'tool_execution_start',
      toolCallId: childId,
      toolName: 'write',
      args: { path: NESTED_FILE_PATH, content: NESTED_FILE_CONTENT },
      parentToolCallId: callId,
    },
    nestedEnd: {
      type: 'tool_execution_end',
      toolCallId: childId,
      toolName: 'write',
      result: {
        content: [{ type: 'text', text: `Successfully wrote 20 bytes to ${NESTED_FILE_PATH}` }],
      },
      isError: false,
      durationMs: 3,
      parentToolCallId: callId,
    },
    progress: progress([childCall]),
    end: {
      type: 'tool_execution_end',
      toolCallId: callId,
      toolName: 'codemode',
      result: {
        content: [
          { type: 'text', text: CODEMODE_RESULT_HEADER },
          { type: 'text', text: `Successfully wrote 20 bytes to ${NESTED_FILE_PATH}` },
        ],
        details: { calls: [childCall] },
      },
      isError: false,
      durationMs: 25,
    },
  } satisfies Record<string, RawEvent>
}

/** A whole prompt turn: user, assistant codemode call, nested write, codemode result, final text. */
export function codemodeTurnEvents(): SessionEvent[] {
  const tool = codemodeToolEvents()
  const toolCall = {
    type: 'toolCall',
    id: CODEMODE_CALL_ID,
    name: 'codemode',
    arguments: tool.start.args,
  }
  const assistantWithCall = { role: 'assistant', content: [toolCall], timestamp: 1_001 }
  const toolResult = {
    role: 'toolResult',
    toolCallId: CODEMODE_CALL_ID,
    toolName: 'codemode',
    content: tool.end.result.content,
    isError: false,
    nestedCalls: nestedCallsRecord(CODEMODE_CALL_ID),
    timestamp: 1_002,
  }
  const finalMessage = {
    role: 'assistant',
    content: [{ type: 'text', text: FINAL_TEXT }],
    timestamp: 1_003,
  }
  return parseEvents([
    { type: 'agent_start' },
    { type: 'turn_start', timestamp: 1_000 },
    {
      type: 'message_start',
      message: { role: 'user', content: 'Write nested.txt', timestamp: 1_000 },
    },
    {
      type: 'message_end',
      message: { role: 'user', content: 'Write nested.txt', timestamp: 1_000 },
    },
    { type: 'message_start', message: { role: 'assistant', content: [], timestamp: 1_001 } },
    { type: 'message_end', message: assistantWithCall },
    tool.start,
    tool.running,
    tool.nestedStart,
    tool.nestedEnd,
    tool.progress,
    tool.end,
    { type: 'message_start', message: toolResult },
    { type: 'message_end', message: toolResult },
    { type: 'turn_end', message: assistantWithCall, toolResults: [toolResult] },
    { type: 'turn_start', timestamp: 1_003 },
    { type: 'message_start', message: { role: 'assistant', content: [], timestamp: 1_003 } },
    {
      type: 'message_update',
      message: finalMessage,
      assistantMessageEvent: { type: 'text_delta', delta: FINAL_TEXT },
    },
    { type: 'message_end', message: finalMessage },
    { type: 'agent_end', messages: [], willRetry: false },
  ])
}

/** The same turn as Pi's JSONL holds it: nested ids appear only inside `nestedCalls`. */
export function persistedCodemodeEntries(toolResultOverrides: RawEvent = {}): SessionEntry[] {
  const at = '2026-09-20T10:00:00.000Z'
  const entry = (id: string, parentId: string | null, message: RawEvent): SessionEntry => ({
    type: 'message',
    id,
    parentId,
    timestamp: at,
    message,
  })
  return [
    entry('e1', null, { role: 'user', content: 'Write nested.txt', timestamp: 1_000 }),
    entry('e2', 'e1', {
      role: 'assistant',
      content: [
        {
          type: 'toolCall',
          id: CODEMODE_CALL_ID,
          name: 'codemode',
          arguments: { code: CODEMODE_SCRIPT },
        },
      ],
      stopReason: 'toolUse',
      timestamp: 1_001,
    }),
    entry('e3', 'e2', {
      role: 'toolResult',
      toolCallId: CODEMODE_CALL_ID,
      toolName: 'codemode',
      content: [
        { type: 'text', text: CODEMODE_RESULT_HEADER },
        { type: 'text', text: `Successfully wrote 20 bytes to ${NESTED_FILE_PATH}` },
      ],
      isError: false,
      nestedCalls: nestedCallsRecord(CODEMODE_CALL_ID),
      timestamp: 1_002,
      ...toolResultOverrides,
    }),
    entry('e4', 'e3', {
      role: 'assistant',
      content: [{ type: 'text', text: FINAL_TEXT }],
      stopReason: 'stop',
      timestamp: 1_003,
    }),
  ]
}
