import { describe, expect, it } from 'vitest'
import { buildProviderWeekColumns } from '../src/components/usage/usageProviderTrend'

describe('buildProviderWeekColumns', () => {
  it('aggregates dailyModels into weekly provider shares', () => {
    const cols = buildProviderWeekColumns(
      [
        {
          date: '2026-06-02',
          model: 'a',
          provider: 'deepseek',
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 100,
          durationMs: 0,
          cost: 0,
          turnCount: 1,
          sessionCount: 1,
        },
        {
          date: '2026-06-03',
          model: 'b',
          provider: 'minimax',
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 100,
          durationMs: 0,
          cost: 0,
          turnCount: 1,
          sessionCount: 1,
        },
      ],
      8
    )
    expect(cols.length).toBe(1)
    expect(cols[0]?.totalTokens).toBe(200)
    expect(cols[0]?.segments).toHaveLength(2)
    const shares = cols[0]!.segments.map((s) => s.share).sort()
    expect(shares[0]).toBeCloseTo(0.5)
    expect(shares[1]).toBeCloseTo(0.5)
  })
})
