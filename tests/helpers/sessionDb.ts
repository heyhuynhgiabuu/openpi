import type Database from 'better-sqlite3'

/**
 * Schema inspection helpers for the migration tests. `better-sqlite3` returns
 * untyped rows, so each query is paired with the row shape its call site
 * expects.
 */

export interface ColumnInfo {
  name: string
  type: string
  notnull: number
  dflt_value: string | null
  pk: number
}

export function schemaProbe(db: Database.Database) {
  function rows<T>(sql: string, ...params: Array<string | null>): T[] {
    // SAFETY: every call site passes a query whose columns match `T`.
    return db.prepare(sql).all(...params) as T[]
  }

  function first<T>(sql: string, ...params: Array<string | null>): T | undefined {
    // SAFETY: every call site passes a query whose columns match `T`.
    return db.prepare(sql).get(...params) as T | undefined
  }

  function columnInfo(table: string): ColumnInfo[] {
    return rows<ColumnInfo>(`pragma table_info(${table})`)
  }

  function columnNames(table: string): string[] {
    return columnInfo(table).map((column) => column.name)
  }

  function defaultOf(table: string, column: string): string | null | undefined {
    return first<{ dflt_value: string | null }>(
      'select dflt_value from pragma_table_info(?) where name = ?',
      table,
      column
    )?.dflt_value
  }

  function primaryKey(table: string): string[] {
    return columnInfo(table)
      .filter((column) => column.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((column) => column.name)
  }

  function indexColumns(index: string): string[] {
    return rows<{ name: string }>(`pragma index_info(${index})`).map((row) => row.name)
  }

  function indexList(table: string): Array<{ name: string; unique: number }> {
    return rows<{ name: string; unique: number }>(`pragma index_list(${table})`)
  }

  function notNullColumns(table: string): string[] {
    return columnInfo(table)
      .filter((column) => column.notnull === 1)
      .map((column) => column.name)
  }

  /** A session needs its workspace first: the schema declares that foreign key. */
  function insertWorkspace(): void {
    db.prepare(
      'insert or ignore into workspaces (path, display_name, last_opened_at) values (?, ?, ?)'
    ).run('/work', 'work', null)
  }

  function insertSession(): void {
    insertWorkspace()
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
  }

  function insertEntry(entryId: string): void {
    db.prepare(
      'insert into session_entries (session_path, entry_id, type, timestamp) values (?, ?, ?, ?)'
    ).run('/sessions/a.jsonl', entryId, 'message', '2026-01-01T00:00:00.000Z')
  }

  return {
    rows,
    first,
    columnInfo,
    columnNames,
    defaultOf,
    primaryKey,
    indexColumns,
    indexList,
    notNullColumns,
    insertWorkspace,
    insertSession,
    insertEntry,
  }
}

/** The column name an additive clause adds, e.g. "add column cost real …" → cost. */
export function addedColumn(clause: string): string {
  const match = /^add column (\w+)\b/i.exec(clause.trim())
  if (!match?.[1]) throw new Error(`Unparsable additive clause: ${clause}`)
  return match[1]
}
