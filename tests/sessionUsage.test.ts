import { describe, expect, it } from 'vitest'
import type { SessionEntry } from '../electron/session/sessionEntries'
import {
  calculateCurrentStreak,
  calculateLongestStreak,
  usageMetricsByEntryId,
} from '../electron/session/sessionUsage'
import type { UsageDay } from '../src/lib/ipc'

function usageDay(date: string): UsageDay {
  return {
    date,
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 2,
    durationMs: 0,
    cost: 0,
    turnCount: 1,
    sessionCount: 1,
  }
}

describe('session usage capture', () => {
  it('extracts token, cost, and duration metrics from assistant entries', () => {
    const entries: SessionEntry[] = [
      {
        id: 'model-1',
        parentId: null,
        type: 'model_change',
        timestamp: '2026-01-01T00:00:00.000Z',
        modelId: 'claude-sonnet-4-6',
      },
      {
        id: 'user-1',
        parentId: 'model-1',
        type: 'message',
        timestamp: '2026-01-01T00:00:00.000Z',
        message: { role: 'user', content: 'hello' },
      },
      {
        id: 'assistant-1',
        parentId: 'user-1',
        type: 'message',
        timestamp: '2026-01-01T00:00:03.000Z',
        message: {
          role: 'assistant',
          content: 'hi',
          usage: {
            input: 10,
            output: 5,
            cacheRead: 3,
            cacheWrite: 2,
            cost: { total: 0.0123 },
          },
        },
      },
    ]

    const metrics = usageMetricsByEntryId(entries).get('assistant-1')

    expect(metrics).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 3,
      cacheWriteTokens: 2,
      totalTokens: 20,
      durationMs: 3000,
      cost: 0.0123,
      model: 'claude-sonnet-4-6',
      provider: '',
    })
  })

  it('ignores usage that only carries the provider-side aliases', () => {
    // Pi's Usage type is input/output/cacheRead/cacheWrite; the *Tokens aliases
    // are provider internals and are never persisted.
    const entries: SessionEntry[] = [
      {
        id: 'assistant-1',
        parentId: null,
        type: 'message',
        timestamp: '2026-01-01T00:00:03.000Z',
        message: {
          role: 'assistant',
          content: 'hi',
          usage: {
            inputTokens: 99,
            outputTokens: 99,
            cacheReadTokens: 99,
            cacheWriteTokens: 99,
          },
        },
      },
    ]

    // With the aliases gone the entry contributes no usage at all, so the helper
    // records no metric for it — the fallbacks used to invent one.
    expect(usageMetricsByEntryId(entries).get('assistant-1')).toBeUndefined()
  })

  it('attributes a compaction to the turn it summarized', () => {
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

    // One row, not two: the summary call is part of that turn's cost, and `Turns`
    // counts assistant turns.
    expect(metrics.size).toBe(1)
    const turn = metrics.get('assistant-1')
    expect(turn?.inputTokens).toBe(110)
    expect(turn?.outputTokens).toBe(25)
    expect(turn?.totalTokens).toBe(135)
    expect(turn?.cost).toBeCloseTo(1.5)
  })

  it('attributes a summary to the last turn, not the first', () => {
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

    // Both summaries land on the newest turn, and neither becomes a row.
    expect(metrics.size).toBe(2)
    expect(metrics.get('assistant-1')?.inputTokens).toBe(10)
    expect(metrics.get('assistant-2')?.inputTokens).toBe(32)
  })

  it('ignores a summarization entry that has no turn to attribute it to', () => {
    const entries: SessionEntry[] = [
      {
        id: 'compaction-1',
        parentId: null,
        type: 'compaction',
        timestamp: '2026-01-01T00:00:04.000Z',
        usage: { input: 100 },
      },
    ]

    expect(usageMetricsByEntryId(entries).size).toBe(0)
  })

  it('uses component sum for totalTokens when usage.totalTokens is inflated', () => {
    const entries: SessionEntry[] = [
      {
        id: 'user-1',
        parentId: null,
        type: 'message',
        timestamp: '2026-01-01T00:00:00.000Z',
        message: { role: 'user', content: 'go' },
      },
      {
        id: 'assistant-1',
        parentId: 'user-1',
        type: 'message',
        timestamp: '2026-01-01T00:00:01.000Z',
        message: {
          role: 'assistant',
          content: 'ok',
          usage: {
            input: 10,
            output: 5,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 9_999,
          },
        },
      },
    ]

    const metrics = usageMetricsByEntryId(entries).get('assistant-1')
    expect(metrics?.totalTokens).toBe(15)
  })

  it('prefers assistant message model over model_change when both are present', () => {
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
        id: 'user-1',
        parentId: 'model-1',
        type: 'message',
        timestamp: '2026-01-01T00:00:01.000Z',
        message: { role: 'user', content: 'go' },
      },
      {
        id: 'assistant-1',
        parentId: 'user-1',
        type: 'message',
        timestamp: '2026-01-01T00:00:02.000Z',
        message: {
          role: 'assistant',
          model: 'gpt-4o',
          provider: 'openai',
          content: 'ok',
          usage: { input: 1, output: 1, cost: 0.001 },
        },
      },
    ]

    const metrics = usageMetricsByEntryId(entries).get('assistant-1')
    expect(metrics?.model).toBe('gpt-4o')
    expect(metrics?.provider).toBe('openai')
  })

  it('keeps a current streak alive when the most recent active day is yesterday', () => {
    const now = new Date('2026-01-05T10:00:00.000Z')
    const days = [usageDay('2026-01-02'), usageDay('2026-01-03'), usageDay('2026-01-04')]

    expect(calculateCurrentStreak(days, now)).toBe(3)
  })

  it('calculates the longest contiguous active-day streak', () => {
    const days = [
      usageDay('2026-01-01'),
      usageDay('2026-01-02'),
      usageDay('2026-01-04'),
      usageDay('2026-01-05'),
      usageDay('2026-01-06'),
    ]

    expect(calculateLongestStreak(days)).toBe(3)
  })
})
