import type Database from 'better-sqlite3'
import type {
  UsageDay,
  UsageDayModel,
  UsageModelBucket,
  UsageSummary,
  UsageSummaryRequest,
  UsageTotals,
} from '../../src/lib/ipc'
import type { SessionEntry } from './sessionEntries'
import {
  durationFrom,
  entryTimestampMs,
  isRecord,
  numeric,
  usageTotalTokens,
} from './sessionEntryUtils'

const DEFAULT_USAGE_DAYS = 365
const USAGE_DAY_MS = 86_400_000

/** Day/model totals from token parts so aggregates stay consistent (total_tokens can inflate vs parts). */
const SQL_TOTAL_FROM_PARTS =
  'coalesce(sum(e.input_tokens + e.output_tokens + e.cache_read_tokens + e.cache_write_tokens), 0)'

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

type UsageAggregateRow = {
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
  totalTokens: number | null
  durationMs: number | null
  cost: number | null
  turnCount: number
  sessionCount: number
  longestTaskMs: number | null
}

type UsageDayRow = UsageAggregateRow & {
  date: string
}

const emptyTotals: UsageTotals = {
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
    const inputTokens = numeric(usage.input) || numeric(usage.inputTokens)
    const outputTokens = numeric(usage.output) || numeric(usage.outputTokens)
    const cacheReadTokens = numeric(usage.cacheRead) || numeric(usage.cacheReadTokens)
    const cacheWriteTokens = numeric(usage.cacheWrite) || numeric(usage.cacheWriteTokens)
    const totalTokens =
      inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens || usageTotalTokens(usage)
    const costValue = usage.cost
    const cost = isRecord(costValue) ? numeric(costValue.total) : numeric(costValue)
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
    metricsById.set(entry.id, {
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      totalTokens,
      durationMs,
      cost,
      model: messageModel,
      provider: messageProvider,
    })
  }

  return metricsById
}

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

function readLifetimeUsage(db: Database.Database, workspacePath: string | null): UsageAggregateRow {
  return db
    .prepare(usageAggregateSql(workspacePath))
    .get(...bindWorkspace(workspacePath)) as UsageAggregateRow
}

function readModelUsage(
  db: Database.Database,
  workspacePath: string | null,
  fromDate: string
): UsageModelBucket[] {
  const rows = db
    .prepare(`
          select
            case when e.model is not null and e.model <> '' then e.model else 'unknown' end as model,
            case when e.provider is not null and e.provider <> '' then e.provider else '' end as provider,

        coalesce(sum(e.input_tokens), 0) as inputTokens,
        coalesce(sum(e.output_tokens), 0) as outputTokens,
        coalesce(sum(e.cache_read_tokens), 0) as cacheReadTokens,
        coalesce(sum(e.cache_write_tokens), 0) as cacheWriteTokens,
        ${SQL_TOTAL_FROM_PARTS} as totalTokens,
        coalesce(sum(e.duration_ms), 0) as durationMs,
        coalesce(sum(e.cost), 0) as cost,
        count(*) as turnCount,
        count(distinct s.path) as sessionCount
      from session_entries e
      join sessions s on s.path = e.session_path
      ${usageWhereSql(workspacePath)}
        and (${usageDateSql()}) >= @fromDate
          group by model, provider
          order by totalTokens desc, model asc
        `)
    .all(...bindWorkspaceWithDate(workspacePath, fromDate)) as Array<
    UsageAggregateRow & { model: string; provider: string }
  >

  return rows.map((row) => ({
    model: row.model,
    provider: row.provider || undefined,
    ...rowToTotals(row),
  }))
}

function readModelUsageBetween(
  db: Database.Database,
  workspacePath: string | null,
  fromDate: string,
  toDate: string
): UsageModelBucket[] {
  const params: Record<string, string> = { fromDate, toDate }
  if (workspacePath) params.workspacePath = workspacePath
  const rows = db
    .prepare(
      `
    select
      case when e.model is not null and e.model <> '' then e.model else 'unknown' end as model,
      case when e.provider is not null and e.provider <> '' then e.provider else '' end as provider,

      ${SQL_TOTAL_FROM_PARTS} as totalTokens,
      coalesce(sum(e.input_tokens), 0) as inputTokens,
      coalesce(sum(e.output_tokens), 0) as outputTokens,
      coalesce(sum(e.cache_read_tokens), 0) as cacheReadTokens,
      coalesce(sum(e.cache_write_tokens), 0) as cacheWriteTokens,
      coalesce(sum(e.duration_ms), 0) as durationMs,
      coalesce(sum(e.cost), 0) as cost,
      count(*) as turnCount,
      count(distinct s.path) as sessionCount
    from session_entries e
    join sessions s on s.path = e.session_path
    ${usageWhereSql(workspacePath)}
      and (${usageDateSql()}) >= @fromDate
      and (${usageDateSql()}) <= @toDate
    group by model, provider
    order by totalTokens desc, model asc
  `
    )
    .all(params) as Array<UsageAggregateRow & { model: string; provider: string }>

  return rows.map((row) => ({
    model: row.model,
    provider: row.provider || undefined,
    ...rowToTotals(row),
  }))
}

function readDailyModelUsage(
  db: Database.Database,
  workspacePath: string | null,
  fromDate: string
): UsageDayModel[] {
  const rows = db
    .prepare(`
          select
            ${usageDateSql()} as date,
            case when e.model is not null and e.model <> '' then e.model else 'unknown' end as model,
            case when e.provider is not null and e.provider <> '' then e.provider else '' end as provider,
            coalesce(sum(e.input_tokens), 0) as inputTokens,
            coalesce(sum(e.output_tokens), 0) as outputTokens,
            coalesce(sum(e.cache_read_tokens), 0) as cacheReadTokens,
            coalesce(sum(e.cache_write_tokens), 0) as cacheWriteTokens,
            ${SQL_TOTAL_FROM_PARTS} as totalTokens,
            coalesce(sum(e.duration_ms), 0) as durationMs,
            coalesce(sum(e.cost), 0) as cost,
            count(*) as turnCount,
            count(distinct s.path) as sessionCount
          from session_entries e
          join sessions s on s.path = e.session_path
          ${usageWhereSql(workspacePath)}
            and (${usageDateSql()}) >= @fromDate
          group by date, model, provider
          order by date asc, totalTokens desc
        `)
    .all(...bindWorkspaceWithDate(workspacePath, fromDate)) as Array<
    UsageDayRow & { model: string; provider: string }
  >

  return rows.map((row) => ({
    date: row.date,
    model: row.model,
    provider: row.provider || undefined,
    ...rowToTotals(row),
  }))
}

function readDailyUsage(db: Database.Database, workspacePath: string | null): UsageDay[] {
  const rows = db
    .prepare(usageDailySql(workspacePath))
    .all(...bindWorkspace(workspacePath)) as UsageDayRow[]
  return rows.map((row) => ({ date: row.date, ...rowToTotals(row) }))
}

function readLongestTaskMs(db: Database.Database, workspacePath: string | null): number | null {
  const row = db
    .prepare(`
      select max(e.duration_ms) as longestTaskMs
      from session_entries e
      join sessions s on s.path = e.session_path
      ${usageWhereSql(workspacePath)}
    `)
    .get(...bindWorkspace(workspacePath)) as { longestTaskMs: number | null }
  return row.longestTaskMs && row.longestTaskMs > 0 ? row.longestTaskMs : null
}

function usageAggregateSql(workspacePath: string | null): string {
  return `
    select
      coalesce(sum(e.input_tokens), 0) as inputTokens,
      coalesce(sum(e.output_tokens), 0) as outputTokens,
      coalesce(sum(e.cache_read_tokens), 0) as cacheReadTokens,
      coalesce(sum(e.cache_write_tokens), 0) as cacheWriteTokens,
      ${SQL_TOTAL_FROM_PARTS} as totalTokens,
      coalesce(sum(e.duration_ms), 0) as durationMs,
      coalesce(sum(e.cost), 0) as cost,
      count(*) as turnCount,
      count(distinct s.path) as sessionCount,
      max(e.duration_ms) as longestTaskMs
    from session_entries e
    join sessions s on s.path = e.session_path
    ${usageWhereSql(workspacePath)}
  `
}

function usageDailySql(workspacePath: string | null): string {
  return `
    select
      ${usageDateSql()} as date,
      coalesce(sum(e.input_tokens), 0) as inputTokens,
      coalesce(sum(e.output_tokens), 0) as outputTokens,
      coalesce(sum(e.cache_read_tokens), 0) as cacheReadTokens,
      coalesce(sum(e.cache_write_tokens), 0) as cacheWriteTokens,
      ${SQL_TOTAL_FROM_PARTS} as totalTokens,
      coalesce(sum(e.duration_ms), 0) as durationMs,
      coalesce(sum(e.cost), 0) as cost,
      count(*) as turnCount,
      count(distinct s.path) as sessionCount,
      max(e.duration_ms) as longestTaskMs
    from session_entries e
    join sessions s on s.path = e.session_path
    ${usageWhereSql(workspacePath)}
    group by date
    order by date asc
  `
}

function usageWhereSql(workspacePath: string | null): string {
  const clauses = ['(e.total_tokens > 0 or e.cost > 0 or e.duration_ms > 0)']
  if (workspacePath) clauses.push('s.workspace_path = @workspacePath')
  return `where ${clauses.join(' and ')}`
}

function usageDateSql(): string {
  return "case when e.timestamp is not null and e.timestamp <> '' then substr(e.timestamp, 1, 10) else substr(s.updated_at, 1, 10) end"
}

function bindWorkspace(workspacePath: string | null): [] | [{ workspacePath: string }] {
  return workspacePath ? [{ workspacePath }] : []
}

function bindWorkspaceWithDate(
  workspacePath: string | null,
  fromDate: string
): [] | [{ workspacePath: string; fromDate: string }] | [{ fromDate: string }] {
  if (workspacePath) return [{ workspacePath, fromDate }]
  return [{ fromDate }]
}

function rowToTotals(row: UsageAggregateRow): UsageTotals {
  const inputTokens = Number(row.inputTokens ?? 0)
  const outputTokens = Number(row.outputTokens ?? 0)
  const cacheReadTokens = Number(row.cacheReadTokens ?? 0)
  const cacheWriteTokens = Number(row.cacheWriteTokens ?? 0)
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens: Number(row.totalTokens ?? 0),
    durationMs: Number(row.durationMs ?? 0),
    cost: Number(row.cost ?? 0),
    turnCount: Number(row.turnCount ?? 0),
    sessionCount: Number(row.sessionCount ?? 0),
    cacheHitRate: cacheHitRate(inputTokens, cacheReadTokens),
  }
}

function cacheHitRate(inputTokens: number, cacheReadTokens: number): number | null {
  const billed = inputTokens + cacheReadTokens
  if (billed <= 0) return null
  return cacheReadTokens / billed
}

function sumDaysSince(days: UsageDay[], startDate: string): UsageTotals {
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

function peakUsageDay(days: UsageDay[]): UsageDay | null {
  return days.reduce<UsageDay | null>((peak, day) => {
    if (!peak || day.totalTokens > peak.totalTokens) return day
    return peak
  }, null)
}

function normalizeUsageDays(days: number | undefined): number {
  return Math.min(366, Math.max(1, Math.floor(days ?? DEFAULT_USAGE_DAYS)))
}

function dateKey(date: Date): string {
  return startOfDay(date).toISOString().slice(0, 10)
}

function parseDateKey(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function addDays(date: Date, days: number): Date {
  return new Date(startOfDay(date).getTime() + days * USAGE_DAY_MS)
}
