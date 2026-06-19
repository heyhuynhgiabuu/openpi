import { describe, expect, it } from 'vitest'
import { buildUsageCsvContent } from '../src/components/usage/usageExport'
import type { UsageSummary } from '../src/lib/ipc'

const emptyTotals = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 0,
  durationMs: 0,
  cost: 0,
  turnCount: 0,
  sessionCount: 0,
}

describe('usageExport', () => {
  it('builds CSV with daily and model rows', () => {
    const summary: UsageSummary = {
      generatedAt: '2026-06-01T00:00:00.000Z',
      workspacePath: null,
      days: 30,
      lifetime: { ...emptyTotals, activeDays: 0, longestTaskMs: null },
      today: emptyTotals,
      last7Days: emptyTotals,
      last30Days: emptyTotals,
      currentStreakDays: 0,
      longestStreakDays: 0,
      peakDay: null,
      daily: [
        {
          date: '2026-06-01',
          ...emptyTotals,
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          cost: 0.01,
          turnCount: 1,
          sessionCount: 1,
        },
      ],
      models: [
        {
          model: 'gpt-4o',
          provider: 'openai',
          ...emptyTotals,
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          cost: 0.01,
          turnCount: 1,
          sessionCount: 1,
        },
      ],
      dailyModels: [],
      previousRange: { days: 30, models: [] },
    }

    const csv = buildUsageCsvContent(summary, 'All projects')
    expect(csv).toContain('section,date,model')
    expect(csv).toContain('daily,2026-06-01')
    expect(csv).toContain('model,,gpt-4o,openai')
    expect(csv).toContain('# scope: All projects')
  })
})
