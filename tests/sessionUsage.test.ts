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
