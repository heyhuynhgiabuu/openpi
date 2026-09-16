/**
 * SQL builders and row shapes for the usage indexer. All queries are
 * read-only aggregates over session_entries joined to sessions.
 */

import type { UsageTotals } from '../../src/lib/ipc'

/** Day/model totals from token parts so aggregates stay consistent (total_tokens can inflate vs parts). */
export const SQL_TOTAL_FROM_PARTS =
  'coalesce(sum(e.input_tokens + e.output_tokens + e.cache_read_tokens + e.cache_write_tokens), 0)'

/**
 * `Turns` counts assistant messages only. Summarization calls and a toolResult's
 * nested usage are stored as their own rows (so their tokens land in the right
 * model bucket) under their own `type`, and are not turns.
 */
export const SQL_TURN_COUNT = "sum(case when e.type = 'message' then 1 else 0 end) as turnCount"

export type UsageAggregateRow = {
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

export type UsageDayRow = UsageAggregateRow & {
  date: string
}

export function usageAggregateSql(workspacePath: string | null): string {
  return `
    select
      coalesce(sum(e.input_tokens), 0) as inputTokens,
      coalesce(sum(e.output_tokens), 0) as outputTokens,
      coalesce(sum(e.cache_read_tokens), 0) as cacheReadTokens,
      coalesce(sum(e.cache_write_tokens), 0) as cacheWriteTokens,
      ${SQL_TOTAL_FROM_PARTS} as totalTokens,
      coalesce(sum(e.duration_ms), 0) as durationMs,
      coalesce(sum(e.cost), 0) as cost,
      ${SQL_TURN_COUNT},
      count(distinct s.path) as sessionCount,
      max(e.duration_ms) as longestTaskMs
    from session_entries e
    join sessions s on s.path = e.session_path
    ${usageWhereSql(workspacePath)}
  `
}

export function usageDailySql(workspacePath: string | null): string {
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
      ${SQL_TURN_COUNT},
      count(distinct s.path) as sessionCount,
      max(e.duration_ms) as longestTaskMs
    from session_entries e
    join sessions s on s.path = e.session_path
    ${usageWhereSql(workspacePath)}
    group by date
    order by date asc
  `
}

export function usageWhereSql(workspacePath: string | null): string {
  const clauses = ['(e.total_tokens > 0 or e.cost > 0 or e.duration_ms > 0)']
  if (workspacePath) clauses.push('s.workspace_path = @workspacePath')
  return `where ${clauses.join(' and ')}`
}

export function usageDateSql(): string {
  return "case when e.timestamp is not null and e.timestamp <> '' then substr(e.timestamp, 1, 10) else substr(s.updated_at, 1, 10) end"
}

export function bindWorkspace(workspacePath: string | null): [] | [{ workspacePath: string }] {
  return workspacePath ? [{ workspacePath }] : []
}

export function bindWorkspaceWithDate(
  workspacePath: string | null,
  fromDate: string
): [] | [{ workspacePath: string; fromDate: string }] | [{ fromDate: string }] {
  if (workspacePath) return [{ workspacePath, fromDate }]
  return [{ fromDate }]
}

export const emptyTotals: UsageTotals = {
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
