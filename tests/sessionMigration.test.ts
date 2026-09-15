import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ADDITIVE_COLUMNS, runMigrations } from '../electron/session/sessionMigration'
import { addedColumn, schemaProbe } from './helpers/sessionDb'
import { expectedDefault, expectedType as expectedType_ } from './helpers/sessionSchema'
import {
  ENTRY_COLUMNS,
  NOT_NULL_COLUMNS,
  PREF_COLUMNS,
  SESSIONS_COLUMNS,
  WORKSPACE_COLUMNS,
} from './helpers/sessionSchema'
import { LEGACY_SCHEMA_SQL } from './helpers/sqliteShim'

/**
 * The migrations open the index store on every launch, so they have to be
 * additive and idempotent: a database written by an older build must gain every
 * column the current schema expects, and no row may be lost.
 *
 * `better-sqlite3` cannot be loaded here (native module, Electron ABI), so the
 * shim runs the statements against Node's own SQLite — see
 * `tests/helpers/sqliteShim.ts`. The DDL and the `alter table` statements
 * execute for real.
 */
vi.mock('better-sqlite3', async () => {
  const { createSqliteShim } = await import('./helpers/sqliteShim')
  return createSqliteShim()
})

import Database from 'better-sqlite3'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
})

afterEach(() => {
  db.close()
})

describe('runMigrations — fresh database', () => {
  it('defaults a new session to zero usage and no model', () => {
    runMigrations(db)
    const { first, insertSession } = schemaProbe(db)
    insertSession()
    const row = first<{
      message_count: number
      first_message: string
      cost: number
      input_tokens: number
      last_model: string
      file_mtime: number
      usage_index_version: number
      parent_session_path: string | null
    }>('select * from sessions where path = ?', '/sessions/a.jsonl')
    expect(row?.message_count).toBe(0)
    expect(row?.first_message).toBe('')
    expect(row?.cost).toBe(0)
    expect(row?.input_tokens).toBe(0)
    expect(row?.last_model).toBe('')
    expect(row?.file_mtime).toBe(0)
    // Zero means "usage has not been computed for this row yet", which is what
    // makes the index recompute totals for a database written by an older build.
    expect(row?.usage_index_version).toBe(0)
    expect(row?.parent_session_path).toBeNull()
  })

  it('rejects a session without the required columns', () => {
    runMigrations(db)
    expect(() =>
      db
        .prepare('insert into sessions (path, title, created_at, updated_at) values (?, ?, ?, ?)')
        .run('/sessions/b.jsonl', 'b', 'x', 'x')
    ).toThrow(/not null/i)
  })

  it('enforces one entry per session and entry id', () => {
    runMigrations(db)
    const { insertSession, insertEntry } = schemaProbe(db)
    insertSession()
    insertEntry('e1')
    expect(() => insertEntry('e1')).toThrow(/unique|primary key/i)
  })

  it('refuses a session whose workspace is missing', () => {
    runMigrations(db)
    db.pragma('foreign_keys = ON')
    expect(() =>
      db
        .prepare(
          `insert into sessions (path, session_id, cwd, workspace_path, title, created_at, updated_at)
           values (?, ?, ?, ?, ?, ?, ?)`
        )
        .run('/sessions/x.jsonl', 'sid-x', '/other', '/other', 'x', 'x', 'x')
    ).toThrow(/foreign key/i)
  })

  it('cascades entry deletes when a session is removed', () => {
    runMigrations(db)
    db.pragma('foreign_keys = ON')
    const { first, insertSession, insertEntry } = schemaProbe(db)
    insertSession()
    insertEntry('e1')
    db.prepare('delete from sessions where path = ?').run('/sessions/a.jsonl')
    expect(first<{ n: number }>('select count(*) as n from session_entries')?.n).toBe(0)
  })

  it('stores preferences as key/value rows', () => {
    runMigrations(db)
    const { first } = schemaProbe(db)
    db.prepare('insert into prefs (key, value) values (?, ?)').run('theme', 'dark')
    expect(first<{ value: string }>('select value from prefs where key = ?', 'theme')?.value).toBe(
      'dark'
    )
  })
})

describe('runMigrations — existing database', () => {
  it('is idempotent', () => {
    runMigrations(db)
    const { columnNames } = schemaProbe(db)
    const before = columnNames('sessions')
    expect(before).toHaveLength(21)
    expect(() => runMigrations(db)).not.toThrow()
    expect(columnNames('sessions')).toEqual(before)
    expect(columnNames('session_entries')).toEqual(ENTRY_COLUMNS)
  })

  it('upgrades a database from the first beta schema', () => {
    // The frozen `f900049` schema is the oldest a user can still have. Migrating
    // it must produce exactly the current schema — this is what catches a column
    // added to the create-table statements but forgotten in ADDITIVE_COLUMNS.
    db.exec(LEGACY_SCHEMA_SQL)
    const { columnNames, defaultOf, notNullColumns } = schemaProbe(db)
    // The frozen baseline must stay faithful to f900049, defaults included.
    expect(defaultOf('sessions', 'entry_count')).toBe('0')
    expect(defaultOf('sessions', 'all_messages_text')).toBe("''")
    expect(defaultOf('sessions', 'cost')).toBe('0')
    expect(defaultOf('sessions', 'last_model')).toBe("''")
    expect(defaultOf('session_entries', 'parent_id')).toBeNull()
    expect(columnNames('sessions')).toHaveLength(20)
    expect(columnNames('session_entries')).toHaveLength(5)

    runMigrations(db)

    expect(columnNames('sessions')).toEqual(SESSIONS_COLUMNS)
    expect(columnNames('session_entries')).toEqual(ENTRY_COLUMNS)
    expect(columnNames('workspaces')).toEqual(WORKSPACE_COLUMNS)
    expect(columnNames('prefs')).toEqual(PREF_COLUMNS)
    for (const [table, columns] of NOT_NULL_COLUMNS) {
      expect(notNullColumns(table), table).toEqual(columns)
    }
  })

  it('keeps rows from the first beta schema and fills the new columns', () => {
    db.exec(LEGACY_SCHEMA_SQL)
    const { first } = schemaProbe(db)
    db.prepare('insert into workspaces (path, display_name, last_opened_at) values (?, ?, ?)').run(
      '/work',
      'work',
      '2026-01-01'
    )
    db.prepare(
      `insert into sessions (path, session_id, cwd, workspace_path, title, created_at, updated_at, entry_count)
       values (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('/sessions/a.jsonl', 'sid-1', '/work', '/work', 'a', 'x', 'x', 3)
    db.prepare(
      'insert into session_entries (session_path, entry_id, type, timestamp) values (?, ?, ?, ?)'
    ).run('/sessions/a.jsonl', 'e1', 'message', 'x')

    runMigrations(db)

    const session = first<{ title: string; entry_count: number; usage_index_version: number }>(
      'select * from sessions where path = ?',
      '/sessions/a.jsonl'
    )
    expect(session?.title).toBe('a')
    expect(session?.entry_count).toBe(3)
    expect(session?.usage_index_version).toBe(0)
    const entry = first<{ entry_id: string; total_tokens: number; provider: string }>(
      'select * from session_entries where entry_id = ?',
      'e1'
    )
    expect(entry?.entry_id).toBe('e1')
    expect(entry?.total_tokens).toBe(0)
    expect(entry?.provider).toBe('')
  })

  it('restores every additive column on a database that lacks it', () => {
    runMigrations(db)
    const { columnInfo, columnNames, defaultOf, first, insertSession } = schemaProbe(db)
    insertSession()

    for (const [table, clause] of ADDITIVE_COLUMNS) {
      const column = addedColumn(clause)
      db.exec(`alter table ${table} drop column ${column}`)
      expect(columnNames(table)).not.toContain(column)
    }

    runMigrations(db)

    for (const [table, clause] of ADDITIVE_COLUMNS) {
      const column = addedColumn(clause)
      expect(columnNames(table)).toContain(column)
      // The clause itself decides the type and default an older row gets, so a
      // changed clause is a silent data change even though the column exists.
      expect(defaultOf(table, column), `${table}.${column}`).toBe(
        expectedDefault(`${table}.${column}`)
      )
      const expectedType = expectedType_(`${table}.${column}`)
      if (expectedType) {
        const info = columnInfo(table).find((candidate) => candidate.name === column)
        expect(info?.type.toLowerCase(), `${table}.${column}`).toBe(expectedType)
      }
    }
    // The row that predates the migration survived and took the defaults.
    const row = first<{ title: string; last_model: string; usage_index_version: number }>(
      'select * from sessions where path = ?',
      '/sessions/a.jsonl'
    )
    expect(row?.title).toBe('a')
    expect(row?.last_model).toBe('')
    expect(row?.usage_index_version).toBe(0)
  })

  it('keeps existing values when it re-runs', () => {
    runMigrations(db)
    const { first, insertSession } = schemaProbe(db)
    insertSession()
    db.prepare(
      'update sessions set message_count = 7, last_model = ?, usage_index_version = 4 where path = ?'
    ).run('gpt-5', '/sessions/a.jsonl')

    runMigrations(db)

    const row = first<{ message_count: number; last_model: string; usage_index_version: number }>(
      'select * from sessions where path = ?',
      '/sessions/a.jsonl'
    )
    expect(row?.message_count).toBe(7)
    expect(row?.last_model).toBe('gpt-5')
    expect(row?.usage_index_version).toBe(4)
  })

  it('leaves an already-set workspace trust timestamp alone', () => {
    runMigrations(db)
    const { first } = schemaProbe(db)
    db.prepare('insert into workspaces (path, display_name, last_opened_at) values (?, ?, ?)').run(
      '/work',
      'work',
      null
    )
    db.prepare('update workspaces set trusted_at = ? where path = ?').run('2026-01-02', '/work')

    runMigrations(db)

    expect(
      first<{ trusted_at: string }>('select trusted_at from workspaces where path = ?', '/work')
        ?.trusted_at
    ).toBe('2026-01-02')
  })
})
