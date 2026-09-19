import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '../electron/session/sessionMigration'
import { usageAggregateSql, type UsageAggregateRow } from '../electron/session/sessionUsageSql'

/**
 * The usage aggregates group rows by model and count turns from `session_entries`.
 * A toolResult's nested usage is stored under its own `type` (see
 * `sessionUsage.ts`), so this pins that such a row contributes tokens but never
 * a turn.
 *
 * `better-sqlite3` is a native module built for Electron's ABI, so the shim runs
 * the real SQL against Node's own SQLite.
 */
vi.mock('better-sqlite3', async () => {
  const { createSqliteShim } = await import('./helpers/sqliteShim')
  return createSqliteShim()
})

import Database from 'better-sqlite3'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  runMigrations(db)
  db.prepare('insert into workspaces (path, display_name, last_opened_at) values (?, ?, ?)').run(
    '/work',
    'work',
    null
  )
  db.prepare(
    `insert into sessions (path, session_id, cwd, workspace_path, title, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    '/sessions/a.jsonl',
    'sid-1',
    '/work',
    '/work',
    'a',
    '2026-01-01T00:00:00.000Z',
    '2026-01-01T00:00:00.000Z'
  )
})

afterEach(() => {
  db.close()
})

function insertEntry(
  entryId: string,
  type: string,
  inputTokens: number,
  outputTokens: number,
  totalTokens: number,
  cost: number
): void {
  db.prepare(
    `insert into session_entries (
       session_path, entry_id, parent_id, type, timestamp,
       input_tokens, output_tokens, total_tokens, cost
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    '/sessions/a.jsonl',
    entryId,
    null,
    type,
    '2026-01-01T00:00:01.000Z',
    inputTokens,
    outputTokens,
    totalTokens,
    cost
  )
}

describe('usage aggregates', () => {
  it('adds a toolResult usage row to the tokens without counting it as a turn', () => {
    insertEntry('assistant-1', 'message', 10, 5, 15, 0.1)
    insertEntry('tool-1', 'tool_result', 30, 2, 37, 0.2)

    const row = db.prepare(usageAggregateSql(null)).get() as UsageAggregateRow | undefined
    if (!row) throw new Error('Expected an aggregate row')

    expect(Number(row.turnCount)).toBe(1)
    expect(Number(row.inputTokens)).toBe(40)
    expect(Number(row.totalTokens)).toBe(47)
    expect(Number(row.cost)).toBeCloseTo(0.3)
  })
})
