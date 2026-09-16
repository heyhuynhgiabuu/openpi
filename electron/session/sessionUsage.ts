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
  /**
   * Set when the row is not a turn: today only a toolResult's nested LLM work.
   * The store writes it as the row `type`, which keeps it out of the turn count.
   */
  rowType?: 'tool_result'
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

  for (const entry of entries) {
    if (entry.type === 'model_change') {
      const e = entry as unknown as { modelId?: string; provider?: string }
      if (e.modelId) currentModel = e.modelId
      if (typeof e.provider === 'string' && e.provider) currentProvider = e.provider
      continue
    }

    // A summarization call is its own row (second pass below), so its tokens land
    // in the model bucket that actually generated the summary.
    if (entry.type === 'compaction' || entry.type === 'branch_summary') continue

    if (entry.type !== 'message') continue
    const message = entry.message as unknown
    if (!isRecord(message)) continue
    const role = typeof message.role === 'string' ? message.role : ''

    if (role === 'user') {
      lastUserTimestampMs = entryTimestampMs(entry, message)
      continue
    }

    // A toolResult's nested usage is its own row (second pass below).
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
  }

  appendAttachedUsageRows(entries, metricsById)

  return metricsById
}

/**
 * Usage Pi attaches to a non-assistant entry: a summarization call on the
 * `compaction`/`branch_summary` entry itself, or the nested LLM work a tool
 * reports back on its `toolResult` message. Each gets its own row under the
 * model active on its chain, found by replaying the entry's parent chain: that
 * stays on the entry's branch and sees any `model_change` between the summarized
 * turn and the summary, so the tokens land on the right model. A toolResult's
 * parent is the assistant turn that called the tool, so its own model wins there.
 */
function appendAttachedUsageRows(
  entries: SessionEntry[],
  metricsById: Map<string, UsageEntryMetrics>
): void {
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  for (const entry of entries) {
    const attached = attachedUsage(entry)
    if (!attached) continue
    const parts = readUsageParts(attached.usage)
    if (parts.totalTokens <= 0 && parts.cost <= 0) continue
    const { model, provider } = resolveChainModel(entry, byId)
    const metrics: UsageEntryMetrics = {
      inputTokens: parts.inputTokens,
      outputTokens: parts.outputTokens,
      cacheReadTokens: parts.cacheReadTokens,
      cacheWriteTokens: parts.cacheWriteTokens,
      totalTokens: parts.totalTokens,
      durationMs: 0,
      cost: parts.cost,
      model,
      provider,
    }
    if (attached.rowType) metrics.rowType = attached.rowType
    metricsById.set(entry.id, metrics)
  }
}

interface AttachedUsage {
  usage: Record<string, unknown>
  rowType?: 'tool_result'
}

function attachedUsage(entry: SessionEntry): AttachedUsage | null {
  if (entry.type === 'compaction' || entry.type === 'branch_summary') {
    return isRecord(entry.usage) ? { usage: entry.usage } : null
  }
  if (entry.type !== 'message') return null
  const message = entry.message as unknown
  if (!isRecord(message) || message.role !== 'toolResult') return null
  return isRecord(message.usage) ? { usage: message.usage, rowType: 'tool_result' } : null
}

/**
 * Resolve the model active on an entry's chain. `model_change` is sticky session
 * state and wins over a per-turn `message.model`; when no change is on the chain
 * the nearest assistant turn's model is the best available evidence.
 */
function resolveChainModel(
  entry: SessionEntry,
  byId: Map<string, SessionEntry>
): {
  model: string
  provider: string
} {
  const chain: SessionEntry[] = []
  const seen = new Set<string>()
  let cursor = entry.parentId
  while (cursor && byId.has(cursor) && !seen.has(cursor)) {
    seen.add(cursor)
    const parent = byId.get(cursor)
    if (!parent) break
    chain.push(parent)
    cursor = parent.parentId
  }
  chain.reverse()

  let changedModel = ''
  let changedProvider = ''
  let turnModel = ''
  let turnProvider = ''
  for (const ancestor of chain) {
    if (ancestor.type === 'model_change') {
      const e = ancestor as unknown as { modelId?: string; provider?: string }
      if (typeof e.modelId === 'string' && e.modelId) changedModel = e.modelId
      if (typeof e.provider === 'string' && e.provider) changedProvider = e.provider
      continue
    }
    if (ancestor.type !== 'message') continue
    const message = ancestor.message as unknown
    if (!isRecord(message) || message.role !== 'assistant') continue
    if (typeof message.model === 'string' && message.model.trim()) {
      turnModel = message.model.trim()
    }
    if (typeof message.provider === 'string' && message.provider.trim()) {
      turnProvider = message.provider.trim()
    }
  }

  const model = changedModel || turnModel || ''
  const provider = changedModel ? changedProvider || turnProvider : turnProvider || changedProvider
  return { model, provider: provider || '' }
}
