import { describe, expect, it } from 'vitest'
import { buildDailyModelColumns, findDeltaPct, formatDeltaPct } from '../src/components/usage/usageModelTrend'

describe('buildDailyModelColumns', () => {
    it('produces one column per day with all model segments', () => {
        const rows = [
          { date: '2026-06-01', model: 'a', provider: 'openai', totalTokens: 100 },
          { date: '2026-06-01', model: 'b', provider: 'openai', totalTokens: 50 },
          { date: '2026-06-01', model: 'c', provider: 'openai', totalTokens: 30 },
          { date: '2026-06-01', model: 'd', provider: 'openai', totalTokens: 20 },
        ] as never[]
        const cols = buildDailyModelColumns(rows, { maxDays: 90 })
        expect(cols).toHaveLength(1)
        expect(cols[0]?.totalTokens).toBe(200)
        expect(cols[0]?.segments).toHaveLength(4) // all models shown
        expect(cols[0]?.segments[0]?.label).toBe('a')
        expect(cols[0]?.segments[3]?.label).toBe('d')
      })
})

describe('findDeltaPct / formatDeltaPct', () => {
  it('detects up and down', () => {
    const up = findDeltaPct(120, 100)
    expect(up.state).toBe('up')
    expect(formatDeltaPct(up)).toBe('+20%')

    const down = findDeltaPct(80, 100)
    expect(down.state).toBe('down')
    expect(formatDeltaPct(down)).toBe('-20%')
  })

  it('marks new when previous is zero', () => {
    const fresh = findDeltaPct(50, 0)
    expect(fresh.state).toBe('new')
    expect(formatDeltaPct(fresh)).toBe('New')
  })

  it('marks flat for tiny changes', () => {
    const flat = findDeltaPct(100.2, 100)
    expect(flat.state).toBe('flat')
  })
})