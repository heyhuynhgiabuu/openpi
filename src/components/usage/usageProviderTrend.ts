import type { UsageDayModel } from '../../lib/ipc'
import { getRankOrder } from './usageModelTrend'

export type ProviderWeekSegment = {
  providerKey: string
  label: string
  tokens: number
  share: number
}

export type ProviderWeekColumn = {
  weekStart: string
  label: string
  totalTokens: number
  segments: ProviderWeekSegment[]
}

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  deepseek: 'DeepSeek',
  minimax: 'MiniMax',
  moonshot: 'Moonshot',
  zhipu: 'Zhipu',
  qwen: 'Qwen',
  xai: 'xAI',
  'opencode-go': 'OpenCode Go',
  xiaomi: 'Xiaomi',
  fireworks: 'Fireworks',
}

const PROVIDER_COLORS = [
  '#ed6aff',
  '#a684ff',
  '#7c86ff',
  '#51a2ff',
  '#00d3f2',
  '#00d5be',
  '#00bc7d',
  '#9ae600',
  '#ffb900',
]

export function providerKeyFromRow(provider: string | undefined): string {
  const p = provider?.trim().toLowerCase()
  return p || '__unknown__'
}

export function providerLabelFromKey(key: string): string {
  if (key === '__unknown__') return 'Unknown'
  return PROVIDER_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1)
}

function weekStartUtc(dateIso: string): string {
  const d = new Date(`${dateIso}T12:00:00.000Z`)
  const day = d.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setUTCDate(d.getUTCDate() + diff)
  return d.toISOString().slice(0, 10)
}

function formatWeekLabel(weekStart: string): string {
  const [, m, d] = weekStart.split('-').map(Number)
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
  return `${months[(m ?? 1) - 1] ?? m} ${d}`
}

/** Stacked weekly provider shares from dailyModels (UTC weeks, Mon-based), ranked by range totals. */
export function buildProviderWeekColumns(
  dailyModels: UsageDayModel[],
  maxWeeks: number
): ProviderWeekColumn[] {
  const byWeek = new Map<string, Map<string, number>>()

  for (const row of dailyModels) {
    const wk = weekStartUtc(row.date)
    const pk = providerKeyFromRow(row.provider)
    const weekMap = byWeek.get(wk) ?? new Map<string, number>()
    weekMap.set(pk, (weekMap.get(pk) ?? 0) + row.totalTokens)
    byWeek.set(wk, weekMap)
  }

  const sortedWeeks = [...byWeek.keys()].sort().slice(-maxWeeks)
  const selectedWeeks = new Set(sortedWeeks)
  const rankItems: { key: string; value: number; index: number }[] = []
  let firstIndex = 0
  for (const row of dailyModels) {
    const wk = weekStartUtc(row.date)
    if (!selectedWeeks.has(wk)) continue
    rankItems.push({
      key: providerKeyFromRow(row.provider),
      value: row.totalTokens,
      index: firstIndex++,
    })
  }
  const order = getRankOrder(rankItems)
  const providerKeys = [...order.entries()].sort((a, b) => a[1] - b[1]).map(([key]) => key)

  return sortedWeeks.map((weekStart) => {
    const weekMap = byWeek.get(weekStart)!
    const total = [...weekMap.values()].reduce((a, b) => a + b, 0)
    const segments = providerKeys.map((providerKey) => {
      const tokens = weekMap.get(providerKey) ?? 0
      return {
        providerKey,
        label: providerLabelFromKey(providerKey),
        tokens,
        share: total > 0 ? tokens / total : 0,
      }
    })

    return {
      weekStart,
      label: formatWeekLabel(weekStart),
      totalTokens: total,
      segments,
    }
  })
}

/** Stable OpenCode-style colors for provider rank in chart. */
export function providerChartColor(key: string, index: number): string {
  if (key === '__unknown__') return 'var(--surface-card)'
  return PROVIDER_COLORS[Math.max(0, index) % PROVIDER_COLORS.length]!
}
