import type { UsageDay } from '../../lib/ipc'
import { formatCurrency } from '../../lib/sessionView'
import { rangeLabel, type RangeKey } from './usageRange'
export const MONTH_LABELS: readonly string[] = [
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

export function formatSharePct(pct: number): string {
  const clamped = Math.min(100, Math.max(0, pct))
  return `${clamped.toFixed(clamped >= 10 ? 0 : 1)}%`
}

export function cacheHitRate(inputTokens: number, cacheReadTokens: number): number | null {
  const billed = inputTokens + cacheReadTokens
  if (billed <= 0) return null
  return cacheReadTokens / billed
}

export function formatCacheHitRate(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return '—'
  return `${Math.round(rate * 100)}%`
}

export function formatCostPerSession(cost: number, sessions: number): string {
  if (cost <= 0 || sessions <= 0) return '—'
  return formatCurrency(cost / sessions)
}

export function formatRangeSpan(days: UsageDay[], range: RangeKey): string {
  if (days.length === 0) return `${rangeLabel(range)} · no activity`
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date))
  const first = sorted[0]?.date
  const last = sorted[sorted.length - 1]?.date
  if (!first || !last) return ''
  return `${formatDisplayDate(first)} → ${formatDisplayDate(last)}`
}

export function formatDisplayDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  if (!y || !m || !d) return isoDate
  const month = MONTH_LABELS[m - 1] ?? String(m)
  return `${month} ${d}, ${y}`
}

export function formatRelativeGenerated(iso: string): string {
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return ''
  const sec = Math.floor((Date.now() - then) / 1000)
  if (sec < 60) return 'just now'
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86_400) return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86_400)}d ago`
}

export function workspaceScopeFromPath(path: string | null): string {
  if (!path?.trim()) return 'All projects'
  const parts = path.replace(/\/$/, '').split(/[/\\]/)
  return parts[parts.length - 1] || path
}

export function formatTokenMetric(tokens: number): string {
  if (tokens >= 1_000_000_000) return `${(tokens / 1_000_000_000).toFixed(1)}B`
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`
  return tokens.toLocaleString()
}

export function formatProviderLabel(provider: string | undefined): string {
  if (!provider) return ''
  const labels: Record<string, string> = {
    anthropic: 'Anthropic',
    openai: 'OpenAI',
    google: 'Google',
    deepseek: 'DeepSeek',
    minimax: 'MiniMax',
    moonshot: 'Moonshot',
    zhipu: 'Zhipu',
    qwen: 'Qwen',
    xai: 'xAI',
  }
  const key = provider.toLowerCase()
  return labels[key] ?? provider.charAt(0).toUpperCase() + provider.slice(1)
}
