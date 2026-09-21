import { DatabaseSync } from 'node:sqlite'

/**
 * A `better-sqlite3` stand-in for tests that need real SQL.
 *
 * The shipped driver is a native module rebuilt for Electron's ABI, so it cannot
 * be loaded under vitest. This shim keeps a real SQLite engine (`node:sqlite`,
 * available without a flag since Node 22.13) behind the small part of the
 * better-sqlite3 surface the tests use: `exec`, `prepare` (all/get/run),
 * `pragma` and `close`.
 *
 * Differences to keep in mind if this is ever used to drive the real store:
 * it always opens `:memory:` and ignores the path argument. Its transaction
 * wrapper is intentionally small and only covers the callback form used by
 * OpenPi's stores.
 *
 * Foreign keys are enforced by default here, which matches production: the store
 * turns them on explicitly (`sessionIndex.ts:61`).
 */

type SqlParam = string | number | null
type Row = Record<string, SqlParam>

interface SqliteShim {
  default: new (path: string) => SqliteShimDatabase
}

interface SqliteShimDatabase {
  exec: (sql: string) => void
  prepare: (sql: string) => {
    all: (...params: Array<SqlParam | Record<string, SqlParam>>) => Row[]
    get: (...params: Array<SqlParam | Record<string, SqlParam>>) => Row | undefined
    run: (...params: Array<SqlParam | Record<string, SqlParam>>) => void
  }
  pragma: (source: string) => void
  transaction: <T>(fn: (...args: never[]) => T) => (...args: never[]) => T
  close: () => void
}

const namedParameterPattern = /[@:$]([A-Za-z_][A-Za-z0-9_]*)/g

type NamedParameters = Record<string, SqlParam>

function isNamedParameters(value: SqlParam | NamedParameters): value is NamedParameters {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function namedParameterNames(sql: string): string[] {
  return Array.from(sql.matchAll(namedParameterPattern), (match) => match[1])
}

function positionalSql(sql: string): string {
  return sql.replace(namedParameterPattern, '?')
}

function bindParameters(names: string[], params: Array<SqlParam | NamedParameters>): SqlParam[] {
  const first = params[0]
  if (params.length === 1 && first !== undefined && isNamedParameters(first)) {
    return names.map((name) => first[name] ?? null)
  }

  const values: SqlParam[] = []
  for (const param of params) {
    if (isNamedParameters(param)) throw new Error('Named parameters must be the only binding')
    values.push(param)
  }
  return values
}

export function createSqliteShim(): SqliteShim {
  class Database {
    private readonly engine = new DatabaseSync(':memory:')
    private transactionDepth = 0

    exec(sql: string): void {
      this.engine.exec(sql)
    }

    prepare(sql: string) {
      const names = namedParameterNames(sql)
      const statement = this.engine.prepare(positionalSql(sql))
      return {
        // SAFETY: callers bind SQLite-compatible scalar or named parameters, and
        // node:sqlite returns one object per row keyed by column name.
        all: (...params: Array<SqlParam | NamedParameters>) =>
          statement.all(...bindParameters(names, params)) as Row[],
        // SAFETY: same binding contract; a missing row is `undefined`.
        get: (...params: Array<SqlParam | NamedParameters>) =>
          statement.get(...bindParameters(names, params)) as Row | undefined,
        run: (...params: Array<SqlParam | NamedParameters>) =>
          statement.run(...bindParameters(names, params)),
      }
    }

    pragma(source: string): void {
      this.engine.exec(`pragma ${source}`)
    }

    transaction<T>(fn: (...args: never[]) => T): (...args: never[]) => T {
      return (...args: never[]) => {
        const outermost = this.transactionDepth === 0
        if (outermost) this.engine.exec('begin')
        this.transactionDepth += 1
        try {
          const result = fn(...args)
          this.transactionDepth -= 1
          if (outermost) this.engine.exec('commit')
          return result
        } catch (error) {
          this.transactionDepth -= 1
          if (outermost) this.engine.exec('rollback')
          throw error
        }
      }
    }

    close(): void {
      this.engine.close()
    }
  }

  return { default: Database }
}

/**
 * The schema the first beta build shipped (`f900049:electron/sessionIndex.ts`),
 * frozen so a test can migrate it and prove the additive list still covers every
 * column later builds added.
 */
export const LEGACY_SCHEMA_SQL = `
  create table if not exists workspaces (
    path text primary key,
    display_name text not null,
    last_opened_at text
  );

  create table if not exists sessions (
    path text primary key,
    session_id text not null,
    cwd text not null,
    workspace_path text not null,
    title text not null,
    created_at text not null,
    updated_at text not null,
    message_count integer not null default 0,
    first_message text not null default '',
    all_messages_text text not null default '',
    parent_session_path text,
    input_tokens integer not null default 0,
    output_tokens integer not null default 0,
    cache_read_tokens integer not null default 0,
    cache_write_tokens integer not null default 0,
    cost real not null default 0,
    entry_count integer not null default 0,
    branch_count integer not null default 0,
    last_model text not null default '',
    file_mtime integer not null default 0,
    foreign key(workspace_path) references workspaces(path)
  );

  create table if not exists session_entries (
    session_path text not null,
    entry_id text not null,
    parent_id text,
    type text not null,
    timestamp text not null,
    primary key(session_path, entry_id),
    foreign key(session_path) references sessions(path) on delete cascade
  );

  create index if not exists idx_sessions_workspace on sessions(workspace_path);
  create index if not exists idx_sessions_created on sessions(created_at);
  create index if not exists idx_sessions_updated on sessions(updated_at);
  create index if not exists idx_session_entries_parent on session_entries(session_path, parent_id);

  create table if not exists prefs (
    key text primary key,
    value text not null
  );
`
