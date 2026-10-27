import { describe, expect, it } from 'vitest'
import { sessionEventSchema } from '../src/lib/ipc'
import {
  CODEMODE_CALL_ID,
  NESTED_CALL_ID,
  codemodeToolEvents,
  codemodeTurnEvents,
  messageRoleOf,
  nestedCallsRecord,
} from './helpers/nestedToolEvents'

/**
 * Pi adds new session event kinds over time (0.99 added `agent_before_settle`,
 * MCP connect events; later versions may add more). The sidecar forwards every
 * event verbatim, so the renderer schema must keep accepting kinds it does not
 * model yet — while still rejecting known kinds with malformed payloads.
 */
describe('sessionEventSchema forward compatibility', () => {
  it('accepts an unknown event kind through the extension bucket', () => {
    const parsed = sessionEventSchema.parse({
      type: 'agent_before_settle',
      isIdle: true,
      entries: [],
    })
    expect(parsed.type).toBe('agent_before_settle')
  })

  it('still rejects a known event kind with a malformed payload', () => {
    expect(() => sessionEventSchema.parse({ type: 'thinking_level_changed' })).toThrow()
  })
})

/**
 * Codemode nested calls (Pi `ctx.executeTool`) add `parentToolCallId` to the
 * three tool events and Pi 1.1+ adds `durationMs` to `tool_execution_end`. The
 * known-event schemas are passthrough, so both must arrive intact.
 */
describe('sessionEventSchema nested tool events', () => {
  const tool = codemodeToolEvents()

  it('keeps parentToolCallId and the child id on nested start, update and end', () => {
    const update = {
      ...tool.nestedStart,
      type: 'tool_execution_update',
      partialResult: { content: [] },
    }
    for (const raw of [tool.nestedStart, update, tool.nestedEnd]) {
      expect(sessionEventSchema.parse(raw)).toMatchObject({
        type: raw.type,
        toolCallId: NESTED_CALL_ID,
        parentToolCallId: CODEMODE_CALL_ID,
      })
    }
  })

  it('keeps durationMs on tool_execution_end for both the child and the codemode call', () => {
    expect(sessionEventSchema.parse(tool.nestedEnd)).toMatchObject({ durationMs: 3 })
    expect(sessionEventSchema.parse(tool.end)).toMatchObject({ durationMs: 25 })
  })

  it('accepts the codemode progress update that carries its call snapshot in details', () => {
    expect(sessionEventSchema.parse(tool.progress)).toMatchObject({
      toolCallId: CODEMODE_CALL_ID,
      partialResult: { details: { calls: [{ id: NESTED_CALL_ID, status: 'ok' }] } },
    })
  })

  it('still rejects a nested event that lost its child id', () => {
    const { toolCallId: _dropped, ...withoutId } = tool.nestedStart
    expect(() => sessionEventSchema.parse(withoutId)).toThrow()
  })

  it('accepts a whole codemode turn, with nestedCalls kept inside the opaque payloads', () => {
    // codemodeTurnEvents() parses every event through sessionEventSchema.
    const events = codemodeTurnEvents()
    const record = nestedCallsRecord(CODEMODE_CALL_ID)

    expect(events.find((e) => e.type === 'turn_end')).toMatchObject({
      toolResults: [{ toolCallId: CODEMODE_CALL_ID, nestedCalls: record }],
    })
    expect(
      events.find((e) => e.type === 'message_start' && messageRoleOf(e) === 'toolResult')
    ).toMatchObject({ message: { nestedCalls: record } })
  })
})
