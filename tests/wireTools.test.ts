import { describe, expect, it } from 'vitest'
import { applySessionEvent } from '../src/lib/sessionEvents'
import { sessionEventSchema } from '../src/lib/ipc'
import type { Message } from '../src/types/session'
import { schemaFailures, taskId, translateAll } from './helpers/wireEvents'

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
})
