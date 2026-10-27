import { describe, expect, it } from 'vitest'
import { isNestedToolEvent } from '../src/lib/nestedToolEvents'
import { codemodeToolEvents, parseEvents } from './helpers/nestedToolEvents'

describe('isNestedToolEvent', () => {
  const tool = codemodeToolEvents()

  it('flags the start, update and end of a nested call', () => {
    const update = {
      ...tool.nestedStart,
      type: 'tool_execution_update',
      partialResult: { content: [] },
    }
    const [start, progress, end] = parseEvents([tool.nestedStart, update, tool.nestedEnd])

    expect([start, progress, end].map((event) => event && isNestedToolEvent(event))).toEqual([
      true,
      true,
      true,
    ])
  })

  it('does not flag the model-issued codemode call, including its progress and end', () => {
    const events = parseEvents([tool.start, tool.running, tool.progress, tool.end])

    expect(events.some(isNestedToolEvent)).toBe(false)
  })

  it('ignores a missing, empty or non-string parentToolCallId', () => {
    const variants = [undefined, '', 7, null].map((parentToolCallId) => ({
      ...tool.nestedStart,
      parentToolCallId,
    }))

    expect(parseEvents(variants).some(isNestedToolEvent)).toBe(false)
  })

  it('only applies to tool execution events', () => {
    const [event] = parseEvents([{ type: 'agent_start', parentToolCallId: 'x' }])

    expect(event && isNestedToolEvent(event)).toBe(false)
  })
})
