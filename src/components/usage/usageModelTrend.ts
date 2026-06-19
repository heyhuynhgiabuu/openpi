import type { UsageDayModel } from '../../lib/ipc'

export type TrendSegment = {
  modelKey: string
  label: string
  providerLabel: string
  tokens: number
  share: number
}

export type TrendColumn = {
  date: string
  label: string
  totalTokens: number
  segments: TrendSegment[]
}

export const MODEL_COLORS = [
  '#ed6aff',
  '#a684ff',
  '#7c86ff',
  '#51a2ff',
  '#00d3f2',
  '#00d5be',
  '#00bc7d',
  '#9ae600',
  '#ffb900',
  '#ff8904',
  '#ff6467',
]

export function getRankOrder(
  items: { key: string; value: number; index: number }[]
): Map<string, number> {
  const reduced = items.reduce<Record<string, { key: string; value: number; index: number }>>(
    (result, item) => {
      const existing = result[item.key]
      result[item.key] = {
        key: item.key,
        value: (existing?.value ?? 0) + item.value,
        index: Math.min(existing?.index ?? item.index, item.index),
      }
      return result
    },
    {}
  )

  return new Map(
    Object.values(reduced)
      .sort((a, b) => b.value - a.value || a.index - b.index || a.key.localeCompare(b.key))
      .map((item, index) => [item.key, index] as const)
  )
}

export function pickModelColor(index: number, key: string): string {
  if (key === '__other__') return 'var(--surface-card)'
  return MODEL_COLORS[index % MODEL_COLORS.length]!
}

export function modelColorMap(models: { model: string; provider?: string }[]): Map<string, string> {
  const order = getRankOrder(
    models.map((m, index) => ({ key: modelKey(m.model, m.provider), value: 1, index }))
  )
  const map = new Map<string, string>()
  for (const [key, index] of order) map.set(key, pickModelColor(index, key))
  return map
}

export function modelKey(model: string, provider?: string): string {
  const m = model.trim()
  const p = provider?.trim()
  return p ? `${p.toLowerCase()}::${m}` : m || 'unknown'
}

function formatDateLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ]
  return `${months[m - 1] ?? m} ${d}`
}

/** Build daily stacked columns with every model ordered by total rank in the selected range. */
export function buildDailyModelColumns(
  dailyModels: UsageDayModel[],
  options: { topN?: number; maxDays?: number } = {}
): TrendColumn[] {
  const { maxDays = 90 } = options
  const dates = [...new Set(dailyModels.map((r) => r.date))].sort()
  const sliced = dates.slice(-maxDays)
  const dateSet = new Set(sliced)
  const rowsInRange = dailyModels.filter((row) => dateSet.has(row.date))

  const labels = new Map<string, { model: string; provider: string }>()
  const order = getRankOrder(
    rowsInRange.map((row, index) => {
      const key = modelKey(row.model, row.provider)
      if (!labels.has(key)) labels.set(key, { model: row.model, provider: row.provider ?? '' })
      return { key, value: row.totalTokens, index }
    })
  )
  const sortedKeys = [...order.entries()].sort((a, b) => a[1] - b[1]).map(([key]) => key)

  return sliced.map((date) => {
    const rows = rowsInRange.filter((r) => r.date === date)
    const total = rows.reduce((s, r) => s + r.totalTokens, 0)
    const byKey = new Map(rows.map((r) => [modelKey(r.model, r.provider), r]))

    const segments: TrendSegment[] = sortedKeys.map((key) => {
      const r = byKey.get(key)
      const label = labels.get(key)
      return {
        modelKey: key,
        label: r?.model ?? label?.model ?? key.split('::').pop() ?? key,
        providerLabel: r?.provider ?? label?.provider ?? '',
        tokens: r?.totalTokens ?? 0,
        share: total > 0 ? (r?.totalTokens ?? 0) / total : 0,
      }
    })

    return { date, label: formatDateLabel(date), totalTokens: total, segments }
  })
}

export function findDeltaPct(
  current: number,
  previous: number
): { pct: number | null; state: 'up' | 'down' | 'flat' | 'new' } {
  if (previous <= 0) {
    if (current <= 0) return { pct: 0, state: 'flat' }
    return { pct: null, state: 'new' }
  }
  const pct = (current - previous) / previous
  if (Math.abs(pct) < 0.005) return { pct: 0, state: 'flat' }
  return { pct, state: pct > 0 ? 'up' : 'down' }
}

export function formatDeltaPct(delta: { pct: number | null; state: string }): string {
  if (delta.state === 'new') return 'New'
  if (delta.pct == null) return '—'
  const sign = delta.pct > 0 ? '+' : ''
  return `${sign}${Math.round(delta.pct * 100)}%`
}
