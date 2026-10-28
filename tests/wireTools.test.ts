import { describe, expect, it } from 'vitest'
import { applySessionEvent } from '../src/lib/sessionEvents'
import { sessionEventSchema } from '../src/lib/ipc'
import type { Message } from '../src/types/session'
import {
  assistant,
  schemaFailures,
  taskId,
  toolEndWithDetails,
  translateAll,
} from './helpers/wireEvents'

/**
 * Phase 8.3k: tool events through the translator (nested calls, streamed output, faulted tools).
 */

describe('tool events', () => {
  const nested = { toolCallId: 'parent/1', toolName: 'write', parentToolCallId: 'parent' }

  it('keeps parentToolCallId on start, update and end so the renderer hides the nested card', () => {
    const wire = translateAll([
      { type: 'tool_execution_start', args: { path: 'a' }, ...nested },
      { type: 'tool_execution_update', output: { set: 'partial' }, ...nested },
      {
        type: 'tool_execution_end',
        result: { taskId: taskId(7), isError: false, diagnostics: [], structuredOutput: 'ok' },
        ...nested,
      },
    ])
    expect(wire.map((e) => e.parentToolCallId)).toEqual(['parent', 'parent', 'parent'])
    expect(schemaFailures(wire)).toEqual([])
    let messages: Message[] = []
    for (const event of wire) {
      const parsed = sessionEventSchema.safeParse(event)
      if (parsed.success) messages = applySessionEvent(messages, parsed.data)
    }
    // A nested call never gets its own card.
    expect(messages).toEqual([])
  })

  it('accumulates streamed tool output, including a trimmed window', () => {
    const base = { toolCallId: 'c1', toolName: 'bash' }
    const wire = translateAll([
      { type: 'tool_execution_start', args: { command: 'ls' }, ...base },
      { type: 'tool_execution_update', output: { set: 'abc' }, ...base },
      { type: 'tool_execution_update', output: { append: 'def' }, ...base },
      { type: 'tool_execution_update', output: { trimStart: 2, append: 'g' }, ...base },
    ])
    const outputs = wire.flatMap((e) => {
      const result = e.partialResult
      return typeof result === 'object' && result !== null && 'content' in result
        ? [JSON.stringify(result.content)]
        : []
    })
    expect(outputs).toEqual([
      '[{"type":"text","text":"abc"}]',
      '[{"type":"text","text":"abcdef"}]',
      '[{"type":"text","text":"cdefg"}]',
    ])
    expect(wire.at(-1)).toMatchObject({ args: { command: 'ls' } })
  })

  it('finishes the card as an error when the tool faulted and left no result', () => {
    const wire = translateAll([
      { type: 'tool_execution_start', args: {}, toolCallId: 'c2', toolName: 'bash' },
      { type: 'tool_execution_end', toolCallId: 'c2', toolName: 'bash' },
    ])
    expect(wire.at(-1)).toMatchObject({ isError: true, result: { content: [] } })
    expect(schemaFailures(wire)).toEqual([])
  })

  it('puts details on the event itself, where the renderer reads them', () => {
    const wire = translateAll([
      { type: 'tool_execution_start', args: {}, toolCallId: 'c3', toolName: 'task' },
      {
        type: 'tool_execution_update',
        output: { set: 'working' },
        details: { phase: 'running' },
        toolCallId: 'c3',
        toolName: 'task',
      },
      toolEndWithDetails('c3', { task_id: 'abc', phase: 'done' }),
    ])
    expect(wire[1]).toMatchObject({ details: { phase: 'running' } })
    expect(wire[2]).toMatchObject({ details: { task_id: 'abc', phase: 'done' } })
    // The SDK-shaped copy stays on the result.
    expect(wire[2]).toMatchObject({ result: { details: { task_id: 'abc', phase: 'done' } } })
    expect(schemaFailures(wire)).toEqual([])
  })

  it('shows the details on the rendered tool card', () => {
    const wire = translateAll([
      { type: 'message_start', message: assistant('') },
      { type: 'tool_execution_start', args: {}, toolCallId: 'c4', toolName: 'task' },
      {
        type: 'tool_execution_update',
        output: { set: 'working' },
        details: { phase: 'running' },
        toolCallId: 'c4',
        toolName: 'task',
      },
      toolEndWithDetails('c4', { task_id: 'abc', phase: 'done' }),
    ])
    let messages: Message[] = []
    for (const event of wire) {
      const parsed = sessionEventSchema.safeParse(event)
      if (parsed.success) messages = applySessionEvent(messages, parsed.data)
    }
    const cards = messages.flatMap((m) => ('toolCards' in m ? m.toolCards : []))
    expect(cards).toHaveLength(1)
    expect(cards[0]?.details).toMatchObject({ task_id: 'abc', phase: 'done' })
  })

  it("puts a nested call's details on the event too", () => {
    const wire = translateAll([
      {
        type: 'tool_execution_end',
        toolCallId: 'p/1',
        toolName: 'write',
        parentToolCallId: 'p',
        result: { taskId: taskId(9), isError: false, diagnostics: [], details: { phase: 'done' } },
      },
    ])
    expect(wire[0]).toMatchObject({ parentToolCallId: 'p', details: { phase: 'done' } })
  })
})
