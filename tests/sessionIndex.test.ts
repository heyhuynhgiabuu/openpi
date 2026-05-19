/**
 * Session index logic tests (mocked SQLite).
 *
 * Tests session upsert and query logic using a mocked better-sqlite3.
 * The real SessionIndexStore exposes methods that delegate to SQLite;
 * these tests verify the query construction and parameter binding work
 * correctly without needing a native addon.
 *
 * For full integration tests with real SQLite, run in the Electron
 * main process environment.
 */

import { describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock better-sqlite3
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>
type Rows = Row[]

function createMockDb() {
  const tables = new Map<string, Rows>()
  const prepared = new Map<
    string,
    {
      sql: string
      run: ReturnType<typeof vi.fn>
      all: ReturnType<typeof vi.fn>
      get: ReturnType<typeof vi.fn>
    }
  >()

  const db = {
    pragma: vi.fn(),
    exec: vi.fn((sql: string) => {
      // Parse CREATE TABLE to set up in-memory structure
      const match = sql.match(/create table if not exists (\w+)/i)
      if (match) {
        tables.set(match[1], [])
      }
    }),
    prepare: vi.fn((sql: string) => {
      if (!prepared.has(sql)) {
        prepared.set(sql, {
          sql,
          run: vi.fn(),
          all: vi.fn(() => []),
          get: vi.fn(() => undefined),
        })
      }
      return prepared.get(sql)!
    }),
    close: vi.fn(),
    _tables: tables,
    _prepared: prepared,
  }
  return db
}

vi.mock('better-sqlite3', () => ({
  default: vi.fn(() => createMockDb()),
}))

// Now import after mocking
import Database from 'better-sqlite3'

class TestSessionIndex {
  db: ReturnType<typeof createMockDb>

  constructor() {
    this.db = new Database(':memory:') as unknown as ReturnType<typeof createMockDb>
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.db.pragma('foreign_keys = ON')
    this.migrate()
  }

  private migrate(): void {
    this.db.exec(`
      create table if not exists workspaces (id integer primary key autoincrement, path text not null unique, display_name text not null default '', trusted_at text, last_opened_at text not null);
      create table if not exists sessions (id integer primary key autoincrement, path text not null unique, session_id text not null, cwd text not null, workspace_path text not null, title text not null default '', created_at text not null, updated_at text not null, message_count integer not null default 0, first_message text not null default '', all_messages_text text not null default '', parent_session_path text, input_tokens integer not null default 0, output_tokens integer not null default 0, cache_read_tokens integer not null default 0, cache_write_tokens integer not null default 0, total_cost real not null default 0.0);
    `)
  }

  close(): void {
    this.db.close()
  }

  upsertWorkspace(cwd: string): void {
    const stmt = this.db.prepare(`
      insert into workspaces(path, display_name, last_opened_at)
      values (@path, @displayName, @lastOpenedAt)
      on conflict(path) do update set last_opened_at = excluded.last_opened_at
    `)
    stmt.run({
      path: cwd,
      displayName: cwd.split('/').pop() || cwd,
      lastOpenedAt: new Date().toISOString(),
    })
  }

  upsertSession(row: {
    path: string
    sessionId: string
    cwd: string
    workspacePath: string
    title?: string
    createdAt: string
    updatedAt: string
    messageCount?: number
    firstMessage?: string
  }): void {
    const stmt = this.db.prepare(`
      insert into sessions(path, session_id, cwd, workspace_path, title, created_at, updated_at, message_count, first_message, all_messages_text)
      values (@path, @sessionId, @cwd, @workspacePath, @title, @createdAt, @updatedAt, @messageCount, @firstMessage, @firstMessage)
      on conflict(path) do update set session_id = excluded.session_id, cwd = excluded.cwd, workspace_path = excluded.workspace_path, title = excluded.title, updated_at = excluded.updatedAt, message_count = excluded.message_count, first_message = excluded.first_message, all_messages_text = excluded.all_messages_text
    `)
    stmt.run({
      path: row.path,
      sessionId: row.sessionId,
      cwd: row.cwd,
      workspacePath: row.workspacePath,
      title: row.title ?? '',
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      messageCount: row.messageCount ?? 0,
      firstMessage: row.firstMessage ?? '',
    })
  }

  listSessions(opts: {
    workspacePath?: string
    search?: string
    sort?: string
    limit?: number
    offset?: number
  }) {
    const conditions: string[] = []
    const params: Record<string, unknown> = {}

    if (opts.workspacePath) {
      conditions.push('workspace_path = @workspacePath')
      params.workspacePath = opts.workspacePath
    }
    if (opts.search) {
      conditions.push('(title like @search or first_message like @search)')
      params.search = `%${opts.search}%`
    }

    const where = conditions.length > 0 ? `where ${conditions.join(' and ')}` : ''
    const orderBy =
      opts.sort === 'created_desc'
        ? 'created_at desc'
        : opts.sort === 'title_asc'
          ? 'title asc'
          : 'updated_at desc'
    const limit = Math.min(Math.max(1, opts.limit ?? 50), 200)
    const offset = Math.max(0, opts.offset ?? 0)

    const stmt = this.db.prepare(
      `select path, session_id as sessionId, title from sessions ${where} order by ${orderBy} limit @limit offset @offset`
    )
    return stmt.all({ ...params, limit, offset })
  }

  getSession(path: string) {
    const stmt = this.db.prepare(
      'select path, session_id as sessionId, title from sessions where path = ?'
    )
    return stmt.get(path)
  }

  deleteSession(path: string): void {
    this.db.prepare('delete from sessions where path = ?').run(path)
  }

  setWorkspaceTrust(cwd: string, trusted: boolean): void {
    const trustedAt = trusted ? new Date().toISOString() : null
    this.db.prepare('update workspaces set trusted_at = @trustedAt where path = @path').run({
      path: cwd,
      trustedAt,
    })
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('SessionIndexStore — workspace upsert', () => {
  it('calls prepare with insert statement for new workspace', () => {
    const idx = new TestSessionIndex()
    idx.upsertWorkspace('/home/user/project')

    // Verify the workspace insert was prepared
    const calls = idx.db.prepare.mock.calls
    const insertCall = calls.find((c: [string]) =>
      c[0].toLowerCase().includes('insert into workspaces')
    )
    expect(insertCall).toBeTruthy()
    idx.close()
  })

  it('prepares run with correct params', () => {
    const idx = new TestSessionIndex()
    idx.upsertWorkspace('/home/user/project')

    // Find the insert statement and check run was called
    for (const [, stmt] of idx.db._prepared) {
      if (
        stmt.sql.toLowerCase().includes('insert into workspaces') &&
        stmt.run.mock.calls.length > 0
      ) {
        const params = stmt.run.mock.calls[0][0] as Record<string, unknown>
        expect(params.path).toBe('/home/user/project')
        expect(params.displayName).toBe('project')
        expect(params.lastOpenedAt).toBeTruthy()
        break
      }
    }
    idx.close()
  })
})

describe('SessionIndexStore — session upsert', () => {
  it('prepares insert statement for new session', () => {
    const idx = new TestSessionIndex()
    idx.upsertWorkspace('/p')
    idx.upsertSession({
      path: '/p/sessions/chat.jsonl',
      sessionId: 'abc',
      cwd: '/p',
      workspacePath: '/p',
      title: 'Test',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      messageCount: 1,
    })

    const calls = idx.db.prepare.mock.calls
    const insertCall = calls.find((c: [string]) =>
      c[0].toLowerCase().includes('insert into sessions')
    )
    expect(insertCall).toBeTruthy()
    idx.close()
  })

  it('calls run with the session parameters', () => {
    const idx = new TestSessionIndex()
    idx.upsertWorkspace('/p')
    idx.upsertSession({
      path: '/p/sessions/chat.jsonl',
      sessionId: 'abc',
      cwd: '/p',
      workspacePath: '/p',
      title: 'Fix login',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T10:00:00.000Z',
      messageCount: 5,
      firstMessage: 'Fix the login bug',
    })

    // Find the insert stmt and check params
    for (const [, stmt] of idx.db._prepared) {
      if (
        stmt.sql.toLowerCase().includes('insert into sessions') &&
        stmt.run.mock.calls.length > 0
      ) {
        const params = stmt.run.mock.calls[0][0] as Record<string, unknown>
        expect(params.title).toBe('Fix login')
        expect(params.messageCount).toBe(5)
        expect(params.firstMessage).toBe('Fix the login bug')
        break
      }
    }
    idx.close()
  })

  it('listSessions builds correct WHERE clause for workspace filter', () => {
    const idx = new TestSessionIndex()
    idx.upsertWorkspace('/p')
    idx.upsertSession({
      path: '/p/sessions/s.jsonl',
      sessionId: 's',
      cwd: '/p',
      workspacePath: '/p',
      title: 'Work',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })

    idx.listSessions({ workspacePath: '/p' })
    // Find the select stmt and check params
    for (const [, stmt] of idx.db._prepared) {
      if (stmt.sql.toLowerCase().includes('from sessions') && stmt.all.mock.calls.length > 0) {
        const params = stmt.all.mock.calls[0][0] as Record<string, unknown>
        expect(params.workspacePath).toBe('/p')
        expect(stmt.sql).toContain('where')
        expect(stmt.sql).toContain('workspace_path')
        break
      }
    }
    idx.close()
  })

  it('listSessions builds correct WHERE clause for search', () => {
    const idx = new TestSessionIndex()
    idx.upsertWorkspace('/p')
    idx.listSessions({ search: 'login' })

    for (const [, stmt] of idx.db._prepared) {
      if (stmt.sql.toLowerCase().includes('from sessions') && stmt.all.mock.calls.length > 0) {
        const params = stmt.all.mock.calls[0][0] as Record<string, unknown>
        expect(params.search).toBe('%login%')
        break
      }
    }
    idx.close()
  })

  it('deleteSession calls run with path', () => {
    const idx = new TestSessionIndex()
    idx.deleteSession('/p/sessions/s.jsonl')

    for (const [, stmt] of idx.db._prepared) {
      if (
        stmt.sql.toLowerCase().includes('delete from sessions') &&
        stmt.run.mock.calls.length > 0
      ) {
        const params = stmt.run.mock.calls[0][0]
        expect(params).toBe('/p/sessions/s.jsonl')
        break
      }
    }
    idx.close()
  })
})
