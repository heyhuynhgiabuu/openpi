/**
 * sessionUsage.ts — the usage summary public API plus the per-entry usage
 * metrics walker, over the split modules:
 *
 *   sessionUsageSql.ts      — SQL builders, row shapes, bind helpers
 *   sessionUsageReads.ts    — database readers and row→totals mapping
 *   sessionUsageStreaks.ts  — streak/peak math and calendar helpers
 */

import type Database from 'better-sqlite3'
import type { UsageSummary, UsageSummaryRequest, UsageTotals } from '../../src/lib/ipc'
import { durationFrom, entryTimestampMs, isRecord, readUsageParts } from './sessionEntryUtils'
import type { SessionEntry } from './sessionEntries'
import { emptyTotals } from './sessionUsageSql'
import {
  readDailyModelUsage,
  readDailyUsage,
  readLifetimeUsage,
  readLongestTaskMs,
  readModelUsage,
  readModelUsageBetween,
  rowToTotals,
} from './sessionUsageReads'
import {
  calculateCurrentStreak,
  calculateLongestStreak,
  dateKey,
  normalizeUsageDays,
  peakUsageDay,
  startOfDay,
  addDays,
  sumDaysSince,
} from './sessionUsageStreaks'

export { calculateCurrentStreak, calculateLongestStreak } from './sessionUsageStreaks'

export type UsageEntryMetrics = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
  durationMs: number
  cost: number
  model: string
  provider: string
}

export function emptyUsageSummary(request: UsageSummaryRequest = {}): UsageSummary {
  const days = normalizeUsageDays(request.days)
  return {
    generatedAt: new Date().toISOString(),
    workspacePath: request.workspacePath ?? null,
    days,
    lifetime: { ...emptyTotals, activeDays: 0, longestTaskMs: null },
    today: { ...emptyTotals },
    last7Days: { ...emptyTotals },
    last30Days: { ...emptyTotals },
    currentStreakDays: 0,
    longestStreakDays: 0,
    peakDay: null,
    daily: [],
    models: [],
    dailyModels: [],
    previousRange: { days: 0, models: [] },
  }
}

export function getUsageSummary(
  db: Database.Database,
  request: UsageSummaryRequest = {}
): UsageSummary {
  const days = normalizeUsageDays(request.days)
  const workspacePath = request.workspacePath?.trim() || null
  const dailyAll = readDailyUsage(db, workspacePath)
  const dailyWindowStart = dateKey(addDays(startOfDay(new Date()), -(days - 1)))
  const daily = dailyAll.filter((day) => day.date >= dailyWindowStart)
  const todayKey = dateKey(new Date())
  const previousStart = dateKey(addDays(startOfDay(new Date()), -(days * 2 - 1)))
  const previousEnd = dateKey(addDays(startOfDay(new Date()), -days))

  return {
    generatedAt: new Date().toISOString(),
    workspacePath,
    days,
    lifetime: {
      ...rowToTotals(readLifetimeUsage(db, workspacePath)),
      activeDays: dailyAll.length,
      longestTaskMs: readLongestTaskMs(db, workspacePath),
    },
    today: sumDaysSince(dailyAll, todayKey),
    last7Days: sumDaysSince(dailyAll, dateKey(addDays(new Date(), -6))),
    last30Days: sumDaysSince(dailyAll, dateKey(addDays(new Date(), -29))),
    currentStreakDays: calculateCurrentStreak(dailyAll, new Date()),
    longestStreakDays: calculateLongestStreak(dailyAll),
    peakDay: peakUsageDay(dailyAll),
    daily,
    models: readModelUsage(db, workspacePath, dailyWindowStart),
    dailyModels: readDailyModelUsage(db, workspacePath, dailyWindowStart),
    previousRange: {
      days,
      models: readModelUsageBetween(db, workspacePath, previousStart, previousEnd),
    },
  }
}

export function usageMetricsByEntryId(entries: SessionEntry[]): Map<string, UsageEntryMetrics> {
  const metricsById = new Map<string, UsageEntryMetrics>()
  let lastUserTimestampMs: number | null = null
  let currentModel = ''
  let currentProvider = ''
  let lastMetrics: UsageEntryMetrics | null = null

  for (const entry of entries) {
    if (entry.type === 'model_change') {
      const e = entry as unknown as { modelId?: string; provider?: string }
      if (e.modelId) currentModel = e.modelId
      if (typeof e.provider === 'string' && e.provider) currentProvider = e.provider
      continue
    }

    if (entry.type === 'compaction' || entry.type === 'branch_summary') {
      // Pi records the summarization call's usage on the entry itself. Attribute it
      // to the turn whose context it summarized: per-turn rows then add up to the
      // session total, and `Turns` stays a count of assistant turns.
      if (lastMetrics && isRecord(entry.usage)) {
        const parts = readUsageParts(entry.usage)
        lastMetrics.inputTokens += parts.inputTokens
        lastMetrics.outputTokens += parts.outputTokens
        lastMetrics.cacheReadTokens += parts.cacheReadTokens
        lastMetrics.cacheWriteTokens += parts.cacheWriteTokens
        lastMetrics.totalTokens += parts.totalTokens
        lastMetrics.cost += parts.cost
      }
      continue
    }

    if (entry.type !== 'message') continue
    const message = entry.message as unknown
    if (!isRecord(message)) continue
    const role = typeof message.role === 'string' ? message.role : ''

    if (role === 'user') {
      lastUserTimestampMs = entryTimestampMs(entry, message)
      continue
    }

    if (role !== 'assistant') continue
    const usage = isRecord(message.usage) ? message.usage : {}
    const { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, totalTokens, cost } =
      readUsageParts(usage)
    const durationMs = durationFrom(lastUserTimestampMs, entryTimestampMs(entry, message)) ?? 0
    const messageModel =
      typeof message.model === 'string' && message.model.trim()
        ? message.model.trim()
        : currentModel
    const messageProvider =
      typeof message.provider === 'string' && message.provider.trim()
        ? message.provider.trim()
        : currentProvider

    if (totalTokens <= 0 && cost <= 0 && durationMs <= 0) continue
    const metrics: UsageEntryMetrics = {
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      totalTokens,
      durationMs,
      cost,
      model: messageModel,
      provider: messageProvider,
    }
    metricsById.set(entry.id, metrics)
    lastMetrics = metrics
  }

  return metricsById
}
