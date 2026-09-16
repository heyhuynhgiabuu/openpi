/**
 * Usage streak/peak math over the normalized daily rows, plus the calendar
 * helpers they share with the summary assembler.
 */

import type { UsageDay, UsageTotals } from '../../src/lib/ipc'
import { cacheHitRate } from './sessionUsageReads'
import { emptyTotals } from './sessionUsageSql'

const USAGE_DAY_MS = 86_400_000
const DEFAULT_USAGE_DAYS = 365

export function calculateCurrentStreak(days: UsageDay[], now: Date): number {
  const activeDays = new Set(days.map((day) => day.date))
  if (activeDays.size === 0) return 0

  let cursor = startOfDay(now)
  if (!activeDays.has(dateKey(cursor)) && activeDays.has(dateKey(addDays(cursor, -1)))) {
    cursor = addDays(cursor, -1)
  }

  let streak = 0
  while (activeDays.has(dateKey(cursor))) {
    streak += 1
    cursor = addDays(cursor, -1)
  }
  return streak
}

export function calculateLongestStreak(days: UsageDay[]): number {
  const sorted = [...new Set(days.map((day) => day.date))].sort()
  let longest = 0
  let current = 0
  let previous: string | null = null

  for (const day of sorted) {
    current = previous && day === dateKey(addDays(parseDateKey(previous), 1)) ? current + 1 : 1
    longest = Math.max(longest, current)
    previous = day
  }

  return longest
}

export function sumDaysSince(days: UsageDay[], startDate: string): UsageTotals {
  const summed = days
    .filter((day) => day.date >= startDate)
    .reduce<UsageTotals>(
      (totals, day) => ({
        inputTokens: totals.inputTokens + day.inputTokens,
        outputTokens: totals.outputTokens + day.outputTokens,
        cacheReadTokens: totals.cacheReadTokens + day.cacheReadTokens,
        cacheWriteTokens: totals.cacheWriteTokens + day.cacheWriteTokens,
        totalTokens: totals.totalTokens + day.totalTokens,
        durationMs: totals.durationMs + day.durationMs,
        cost: totals.cost + day.cost,
        turnCount: totals.turnCount + day.turnCount,
        sessionCount: totals.sessionCount + day.sessionCount,
        cacheHitRate: null,
      }),
      { ...emptyTotals, cacheHitRate: null }
    )
  return {
    ...summed,
    cacheHitRate: cacheHitRate(summed.inputTokens, summed.cacheReadTokens),
  }
}

export function peakUsageDay(days: UsageDay[]): UsageDay | null {
  return days.reduce<UsageDay | null>((peak, day) => {
    if (!peak || day.totalTokens > peak.totalTokens) return day
    return peak
  }, null)
}

export function normalizeUsageDays(days: number | undefined): number {
  return Math.min(366, Math.max(1, Math.floor(days ?? DEFAULT_USAGE_DAYS)))
}

export function dateKey(date: Date): string {
  return startOfDay(date).toISOString().slice(0, 10)
}

function parseDateKey(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

export function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

export function addDays(date: Date, days: number): Date {
  return new Date(startOfDay(date).getTime() + days * USAGE_DAY_MS)
}
