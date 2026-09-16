import { describe, expect, it } from 'vitest'
import { type SessionEntry } from '../electron/session/sessionEntries'
import { usageMetricsByEntryId } from '../electron/session/sessionUsage'

describe('session usage summaries', () => {
  it('gives a compaction its own row under the model that generated it', () => {
    const entries: SessionEntry[] = [
      {
        id: 'assistant-1',
        parentId: null,
        type: 'message',
        timestamp: '2026-01-01T00:00:03.000Z',
        message: { role: 'assistant', content: 'hi', usage: { input: 10, output: 5 } },
      },
      {
        id: 'compaction-1',
        parentId: 'assistant-1',
        type: 'compaction',
        timestamp: '2026-01-01T00:00:04.000Z',
        usage: { input: 100, output: 20, cost: { total: 1.5 } },
      },
    ]

    const metrics = usageMetricsByEntryId(entries)

    // Two rows: the turn keeps its own tokens, and the summary is its own row so
    // its tokens land in the model bucket that actually generated them.
    expect(metrics.size).toBe(2)
    const turn = metrics.get('assistant-1')
    expect(turn?.inputTokens).toBe(10)
    expect(turn?.outputTokens).toBe(5)
    expect(turn?.totalTokens).toBe(15)
    const summary = metrics.get('compaction-1')
    expect(summary?.inputTokens).toBe(100)
    expect(summary?.outputTokens).toBe(20)
    expect(summary?.totalTokens).toBe(120)
    expect(summary?.cost).toBeCloseTo(1.5)
    expect(summary?.model).toBe('')
  })

  it('keeps each summary as its own row instead of merging it into a turn', () => {
    const entries: SessionEntry[] = [
      {
        id: 'assistant-1',
        parentId: null,
        type: 'message',
        timestamp: '2026-01-01T00:00:03.000Z',
        message: { role: 'assistant', content: 'first', usage: { input: 10 } },
      },
      {
        id: 'assistant-2',
        parentId: 'assistant-1',
        type: 'message',
        timestamp: '2026-01-01T00:01:03.000Z',
        message: { role: 'assistant', content: 'second', usage: { input: 20 } },
      },
      {
        id: 'branch-1',
        parentId: 'assistant-2',
        type: 'branch_summary',
        timestamp: '2026-01-01T00:01:04.000Z',
        usage: { input: 5 },
      },
      {
        id: 'compaction-1',
        parentId: 'branch-1',
        type: 'compaction',
        timestamp: '2026-01-01T00:01:05.000Z',
        usage: { input: 7 },
      },
    ]

    const metrics = usageMetricsByEntryId(entries)

    // Four rows: neither summary is merged into a neighbouring turn.
    expect(metrics.size).toBe(4)
    expect(metrics.get('assistant-1')?.inputTokens).toBe(10)
    expect(metrics.get('assistant-2')?.inputTokens).toBe(20)
    expect(metrics.get('branch-1')?.inputTokens).toBe(5)
    expect(metrics.get('compaction-1')?.inputTokens).toBe(7)
  })

  it('buckets a summary under a model_change that lands after the summarized turn', () => {
    const entries: SessionEntry[] = [
      {
        id: 'model-1',
        parentId: null,
        type: 'model_change',
        timestamp: '2026-01-01T00:00:00.000Z',
        modelId: 'old-model',
        provider: 'anthropic',
      },
      {
        id: 'assistant-1',
        parentId: 'model-1',
        type: 'message',
        timestamp: '2026-01-01T00:00:03.000Z',
        message: {
          role: 'assistant',
          content: 'hi',
          model: 'old-model',
          provider: 'anthropic',
          usage: { input: 10 },
        },
      },
      {
        id: 'model-2',
        parentId: 'assistant-1',
        type: 'model_change',
        timestamp: '2026-01-01T00:00:04.000Z',
        modelId: 'new-model',
        provider: 'openai',
      },
      {
        id: 'compaction-1',
        parentId: 'model-2',
        type: 'compaction',
        timestamp: '2026-01-01T00:00:05.000Z',
        usage: { input: 100 },
      },
    ]

    const metrics = usageMetricsByEntryId(entries)

    expect(metrics.get('assistant-1')?.model).toBe('old-model')
    expect(metrics.get('compaction-1')?.model).toBe('new-model')
    expect(metrics.get('compaction-1')?.provider).toBe('openai')
  })

  it('does not borrow the file-order last turn when a branch switch moved on', () => {
    const entries: SessionEntry[] = [
      {
        id: 'assistant-a',
        parentId: null,
        type: 'message',
        timestamp: '2026-01-01T00:00:01.000Z',
        message: { role: 'assistant', content: 'a', model: 'branch-a-model', usage: { input: 10 } },
      },
      // File order appends a turn on another branch that also descends from assistant-a.
      {
        id: 'assistant-b',
        parentId: 'assistant-a',
        type: 'message',
        timestamp: '2026-01-01T00:00:02.000Z',
        message: { role: 'assistant', content: 'b', model: 'branch-b-model', usage: { input: 20 } },
      },
      // The summary belongs to the branch that resumed from assistant-a.
      {
        id: 'compaction-1',
        parentId: 'assistant-a',
        type: 'compaction',
        timestamp: '2026-01-01T00:00:03.000Z',
        usage: { input: 100 },
      },
    ]

    const metrics = usageMetricsByEntryId(entries)

    expect(metrics.size).toBe(3)
    expect(metrics.get('assistant-b')?.inputTokens).toBe(20)
    expect(metrics.get('compaction-1')?.inputTokens).toBe(100)
    // Chain is compaction -> assistant-a, so branch A's model, not file-order assistant-b.
    expect(metrics.get('compaction-1')?.model).toBe('branch-a-model')
  })

  it('gives a branch_summary its own row and ignores fromId for the model', () => {
    const entries: SessionEntry[] = [
      {
        id: 'assistant-1',
        parentId: null,
        type: 'message',
        timestamp: '2026-01-01T00:00:01.000Z',
        message: { role: 'assistant', content: 'a', model: 'chain-model', usage: { input: 1 } },
      },
      {
        id: 'branch-1',
        parentId: 'assistant-1',
        type: 'branch_summary',
        timestamp: '2026-01-01T00:00:02.000Z',
        fromId: 'somewhere-else',
        usage: { input: 5, cost: { total: 0.2 } },
      },
    ]

    const metrics = usageMetricsByEntryId(entries)

    expect(metrics.size).toBe(2)
    expect(metrics.get('branch-1')?.model).toBe('chain-model')
    expect(metrics.get('branch-1')?.inputTokens).toBe(5)
    expect(metrics.get('branch-1')?.cost).toBeCloseTo(0.2)
  })

  it("gives a toolResult's nested usage its own non-turn row under the calling turn's model", () => {
    const entries: SessionEntry[] = [
      {
        id: 'assistant-1',
        parentId: null,
        type: 'message',
        timestamp: '2026-01-01T00:00:01.000Z',
        message: { role: 'assistant', content: 'a', model: 'call-model', usage: { input: 1 } },
      },
      {
        id: 'tool-1',
        parentId: 'assistant-1',
        type: 'message',
        timestamp: '2026-01-01T00:00:02.000Z',
        message: {
          role: 'toolResult',
          toolCallId: 'call_1',
          content: 'done',
          usage: { input: 4, output: 6, cost: { total: 0.25 } },
        },
      },
    ]

    const metrics = usageMetricsByEntryId(entries)

    expect(metrics.size).toBe(2)
    const tool = metrics.get('tool-1')
    expect(tool?.inputTokens).toBe(4)
    expect(tool?.outputTokens).toBe(6)
    expect(tool?.cost).toBeCloseTo(0.25)
    expect(tool?.model).toBe('call-model')
    expect(tool?.rowType).toBe('tool_result')
  })

  it('skips attached rows that carry no usage', () => {
    const entries: SessionEntry[] = [
      {
        id: 'assistant-1',
        parentId: null,
        type: 'message',
        timestamp: '2026-01-01T00:00:01.000Z',
        message: { role: 'assistant', content: 'a', usage: { input: 1 } },
      },
      {
        id: 'compaction-1',
        parentId: 'assistant-1',
        type: 'compaction',
        timestamp: '2026-01-01T00:00:02.000Z',
      },
      {
        id: 'tool-1',
        parentId: 'assistant-1',
        type: 'message',
        timestamp: '2026-01-01T00:00:03.000Z',
        message: { role: 'toolResult', toolCallId: 'call_1', content: 'done' },
      },
    ]

    const metrics = usageMetricsByEntryId(entries)

    expect(metrics.size).toBe(1)
    expect(metrics.get('assistant-1')?.inputTokens).toBe(1)
  })
})
