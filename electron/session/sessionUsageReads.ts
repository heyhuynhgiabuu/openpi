/**
 * Database readers for the usage indexer: lifetime/model/daily aggregates.
 * Every function is a thin, read-only query over the shared SQL builders.
 */

import type Database from 'better-sqlite3'
import type { UsageDay, UsageDayModel, UsageModelBucket, UsageTotals } from '../../src/lib/ipc'
import { resolveTokenRates } from '../services/modelPricing'
import {
  bindWorkspace,
  bindWorkspaceWithDate,
  SQL_TOTAL_FROM_PARTS,
  usageAggregateSql,
  usageDailySql,
  usageDateSql,
  usageWhereSql,
  type UsageAggregateRow,
  type UsageDayRow,
} from './sessionUsageSql'

export function readLifetimeUsage(
  db: Database.Database,
  workspacePath: string | null
): UsageAggregateRow {
  return db
    .prepare(usageAggregateSql(workspacePath))
    .get(...bindWorkspace(workspacePath)) as UsageAggregateRow
}

export function readModelUsage(
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
    rates: resolveTokenRates(row.model, row.provider || undefined),
    ...rowToTotals(row),
  }))
}

export function readModelUsageBetween(
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
    rates: resolveTokenRates(row.model, row.provider || undefined),
    ...rowToTotals(row),
  }))
}

export function readDailyModelUsage(
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

export function readDailyUsage(db: Database.Database, workspacePath: string | null): UsageDay[] {
  const rows = db
    .prepare(usageDailySql(workspacePath))
    .all(...bindWorkspace(workspacePath)) as UsageDayRow[]
  return rows.map((row) => ({ date: row.date, ...rowToTotals(row) }))
}

export function readLongestTaskMs(
  db: Database.Database,
  workspacePath: string | null
): number | null {
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

export function rowToTotals(row: UsageAggregateRow): UsageTotals {
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

export function cacheHitRate(inputTokens: number, cacheReadTokens: number): number | null {
  const billed = inputTokens + cacheReadTokens
  if (billed <= 0) return null
  return cacheReadTokens / billed
}
