/**
 * Usage heatmap: builds the GitHub-style week grid for a range and the
 * tooltip/aria text for individual day cells.
 */

import type { UsageDay, UsageModelBucket } from '../../lib/ipc'
import { formatModelName } from '../../lib/sessionView'
import type { RangeKey } from './usageRange'

export const HEATMAP_WEEKS = 53
const DAYS_PER_WEEK = 7
const DAY_MS = 86_400_000

export type HeatmapCell = {
  date: string
  tokens: number
  level: number
  future: boolean
}

export function heatmapWeeksForRange(range: RangeKey): number {
  if (range === '7d') return 2
  if (range === '30d') return 6
  if (range === '90d') return 14
  return HEATMAP_WEEKS
}

export function buildHeatmapWeeks(days: UsageDay[], weekCount = HEATMAP_WEEKS): HeatmapCell[][] {
  const byDate = new Map(days.map((day) => [day.date, day.totalTokens]))
  const today = startOfUtcDay(new Date())
  const weeksToShow = Math.min(HEATMAP_WEEKS, Math.max(2, weekCount))
  const start = addDays(today, -((weeksToShow - 1) * DAYS_PER_WEEK + today.getUTCDay()))

  const weeks = Array.from({ length: weeksToShow }, (_, weekIndex) =>
    Array.from({ length: DAYS_PER_WEEK }, (_, dayIndex): HeatmapCell => {
      const date = addDays(start, weekIndex * DAYS_PER_WEEK + dayIndex)
      const dateId = dateKey(date)
      const future = date.getTime() > today.getTime()
      return {
        date: dateId,
        tokens: future ? 0 : (byDate.get(dateId) ?? 0),
        level: 0,
        future,
      }
    })
  )

  const maxTokens = Math.max(0, ...weeks.flat().map((day) => day.tokens))
  for (const day of weeks.flat()) {
    day.level = usageLevel(day.tokens, maxTokens)
  }

  return weeks
}

export function buildMonthLabels(weeks: HeatmapCell[][], monthLabels: readonly string[]): string[] {
  const labels: string[] = []
  let previousMonth = -1
  for (const week of weeks) {
    const firstDay = week[0]
    if (!firstDay) continue
    const month = Number(firstDay.date.slice(5, 7)) - 1
    if (month === previousMonth) {
      labels.push('')
      continue
    }
    labels.push(monthLabels[month] ?? '')
    previousMonth = month
  }
  return labels
}

function usageLevel(tokens: number, maxTokens: number): number {
  if (tokens <= 0 || maxTokens <= 0) return 0
  const ratio = tokens / maxTokens
  if (ratio >= 0.75) return 4
  if (ratio >= 0.4) return 3
  if (ratio >= 0.15) return 2
  return 1
}

export function heatmapTooltip(day: HeatmapCell, models: UsageModelBucket[]): string {
  if (day.future) return day.date
  const top = models[0]
  const topModel = top ? formatModelName(top.model) || top.model : ''
  const extra = topModel ? ` · ${topModel}` : ''
  return `${day.date}: ${day.tokens.toLocaleString()} tokens${extra}`
}

export function heatmapAriaLabel(day: HeatmapCell): string {
  if (day.future) return `${day.date}, no data`
  return `${day.date}, ${day.tokens.toLocaleString()} tokens`
}

function dateKey(date: Date): string {
  return startOfUtcDay(date).toISOString().slice(0, 10)
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function addDays(date: Date, days: number): Date {
  return new Date(startOfUtcDay(date).getTime() + days * DAY_MS)
}
