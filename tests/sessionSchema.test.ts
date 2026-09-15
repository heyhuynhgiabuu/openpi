import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ADDITIVE_COLUMNS, runMigrations } from '../electron/session/sessionMigration'
import { addedColumn, schemaProbe } from './helpers/sessionDb'
import {
  COLUMN_DEFAULTS,
  COLUMN_TYPES,
  ENTRY_COLUMNS,
  EXPECTED_INDEXES,
  NOT_NULL_COLUMNS,
  PREF_COLUMNS,
  PRIMARY_KEYS,
  SESSIONS_COLUMNS,
  WORKSPACE_COLUMNS,
} from './helpers/sessionSchema'

/**
 * The shape of the session index schema, pinned as literals. A missing column
 * fails the store's first query ("no such column"), a wrong default silently
 * changes stored numbers, and a unique index where none is declared breaks the
 * second insert in a workspace.
 *
 * `better-sqlite3` cannot be loaded here (native module, Electron ABI), so the
 * shim runs the statements against Node's own SQLite — see
 * `tests/helpers/sqliteShim.ts`. The DDL executes for real.
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
})

afterEach(() => {
  db.close()
})

/** `"sessions.cost"` → `['sessions', 'cost']`. */
function tableAndColumn(key: string): [string, string] {
  const [table = '', column = ''] = key.split('.')
  return [table, column]
}

describe('session index schema', () => {
  it('creates every table the index store uses', () => {
    const { rows } = schemaProbe(db)
    const names = rows<{ name: string }>(
      "select name from sqlite_master where type = 'table' order by name"
    ).map((row) => row.name)
    expect(names).toEqual(['prefs', 'session_entries', 'sessions', 'workspaces'])
  })

  it('gives every table the columns the store reads and writes', () => {
    const { columnNames } = schemaProbe(db)
    expect(columnNames('sessions')).toEqual(SESSIONS_COLUMNS)
    expect(columnNames('session_entries')).toEqual(ENTRY_COLUMNS)
    expect(columnNames('workspaces')).toEqual(WORKSPACE_COLUMNS)
    expect(columnNames('prefs')).toEqual(PREF_COLUMNS)
  })

  it('stores every column with its declared type', () => {
    const { columnInfo } = schemaProbe(db)
    for (const [key, type] of Object.entries(COLUMN_TYPES)) {
      const [table, column] = tableAndColumn(key)
      const info = columnInfo(table).find((candidate) => candidate.name === column)
      // SQLite reports declared type names in its own case, e.g. REAL.
      expect(info?.type.toLowerCase(), key).toBe(type)
    }
    // Every real column is covered, so a new column cannot slip in unpinned.
    for (const table of ['sessions', 'session_entries', 'workspaces', 'prefs']) {
      const covered = Object.keys(COLUMN_TYPES)
        .filter((key) => key.startsWith(`${table}.`))
        .map((key) => tableAndColumn(key)[1])
      expect(covered.sort(), table).toEqual(
        columnInfo(table)
          .map((column) => column.name)
          .sort()
      )
    }
  })

  it('rejects null in every column that declares not null', () => {
    const { notNullColumns } = schemaProbe(db)
    for (const [table, columns] of NOT_NULL_COLUMNS) {
      expect(notNullColumns(table), table).toEqual(columns)
    }
  })

  it('declares the default for every column', () => {
    const { defaultOf } = schemaProbe(db)
    for (const [key, value] of Object.entries(COLUMN_DEFAULTS)) {
      const [table, column] = tableAndColumn(key)
      expect(defaultOf(table, column), key).toBe(value)
    }
  })

  it('keys every table by its declared primary key', () => {
    const { primaryKey } = schemaProbe(db)
    for (const [table, columns] of PRIMARY_KEYS) {
      expect(primaryKey(table), table).toEqual(columns)
    }
  })

  it('creates the lookup indexes on the columns they speed up', () => {
    const { rows, indexColumns, indexList } = schemaProbe(db)
    for (const [name, table, columns, unique] of EXPECTED_INDEXES) {
      expect(indexColumns(name), name).toEqual(columns)
      const listed = indexList(table).find((row) => row.name === name)
      expect(listed, name).toBeDefined()
      expect(listed?.unique, name).toBe(unique ? 1 : 0)
    }
    const all = rows<{ name: string }>(
      "select name from sqlite_master where type = 'index' and name like 'idx_%' order by name"
    ).map((row) => row.name)
    expect(all).toEqual(EXPECTED_INDEXES.map(([name]) => name).sort())
  })
})

describe('ADDITIVE_COLUMNS', () => {
  it('lists exactly the columns later builds added', () => {
    // Literals on purpose: this is the set of columns an older database is
    // missing, so an entry dropped from the list strands that column forever.
    expect(ADDITIVE_COLUMNS.map(([table, clause]) => `${table}.${addedColumn(clause)}`)).toEqual([
      'sessions.last_model',
      'sessions.file_mtime',
      'sessions.usage_index_version',
      'session_entries.input_tokens',
      'session_entries.output_tokens',
      'session_entries.cache_read_tokens',
      'session_entries.cache_write_tokens',
      'session_entries.total_tokens',
      'session_entries.duration_ms',
      'session_entries.cost',
      'session_entries.model',
      'session_entries.provider',
      'workspaces.trusted_at',
    ])
  })

  it('names only columns the create-table statements also declare', () => {
    const { columnNames } = schemaProbe(db)
    for (const [table, clause] of ADDITIVE_COLUMNS) {
      expect(columnNames(table)).toContain(addedColumn(clause))
    }
  })
})
