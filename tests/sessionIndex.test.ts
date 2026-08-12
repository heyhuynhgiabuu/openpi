import { describe, expect, it, vi } from 'vitest'

interface PreparedStatement {
  sql: string
  run: ReturnType<typeof vi.fn>
  all: ReturnType<typeof vi.fn>
  get: ReturnType<typeof vi.fn>
}

const { databaseConstructor, databases } = vi.hoisted(() => {
  const databases: Array<{
    pragma: ReturnType<typeof vi.fn>
    exec: ReturnType<typeof vi.fn>
    prepare: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
    transaction: ReturnType<typeof vi.fn>
    statements: PreparedStatement[]
  }> = []
  const databaseConstructor = vi.fn(() => {
    const statements: PreparedStatement[] = []
    const db = {
      pragma: vi.fn(),
      exec: vi.fn(),
      prepare: vi.fn((sql: string) => {
        const statement = {
          sql,
          run: vi.fn(),
          all: vi.fn(() => []),
          get: vi.fn(() =>
            sql.toLowerCase().includes('select workspace_path from sessions')
              ? { workspace_path: '/workspace' }
              : undefined
          ),
        }
        statements.push(statement)
        return statement
      }),
      close: vi.fn(),
      transaction: vi.fn((fn: (...args: unknown[]) => unknown) => fn),
      statements,
    }
    databases.push(db)
    return db
  })
  return { databaseConstructor, databases }
})

vi.mock('better-sqlite3', () => ({ default: databaseConstructor }))

import { SessionIndexStore } from '../electron/session/sessionIndex'

function createStore(): { store: SessionIndexStore; db: (typeof databases)[number] } {
  const store = new SessionIndexStore('/tmp/openpi-tests/session-index.sqlite')
  const db = databases.at(-1)
  if (!db) throw new Error('Expected production store to create a database')
  return { store, db }
}

function statementContaining(db: (typeof databases)[number], fragment: string): PreparedStatement {
  const statement = db.statements.find((candidate) =>
    candidate.sql.toLowerCase().includes(fragment.toLowerCase())
  )
  if (!statement) throw new Error(`Expected SQL containing ${fragment}`)
  return statement
}

describe('SessionIndexStore production adapter', () => {
  it('configures and migrates the database during construction', () => {
    const { store, db } = createStore()

    expect(db.pragma).toHaveBeenCalledWith('journal_mode = WAL')
    expect(db.pragma).toHaveBeenCalledWith('foreign_keys = ON')
    expect(db.exec).toHaveBeenCalledWith(
      expect.stringContaining('create table if not exists sessions')
    )

    store.close()
    expect(db.pragma).toHaveBeenCalledWith('wal_checkpoint(TRUNCATE)')
    expect(db.close).toHaveBeenCalledOnce()
  })

  it('runs the production workspace upsert with canonical parameters', () => {
    const { store, db } = createStore()

    expect(store.upsertWorkspace('/home/user/project')).toBe('/home/user/project')

    const statement = statementContaining(db, 'insert into workspaces')
    expect(statement.run).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/home/user/project', displayName: 'project' })
    )
    store.close()
  })

  it('runs the production trust update and returns its domain result', () => {
    const { store, db } = createStore()

    const result = store.setWorkspaceTrust('/home/user/project', true)

    expect(result.cwd).toBe('/home/user/project')
    expect(result.trusted).toBe(true)
    expect(result.trustedAt).toEqual(expect.any(String))
    expect(statementContaining(db, 'update workspaces set trusted_at').run).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/home/user/project', trustedAt: expect.any(String) })
    )
    store.close()
  })

  it('queries the production store for an indexed session workspace', () => {
    const { store, db } = createStore()
    expect(store.getSessionWorkspace('/sessions/thread.jsonl')).toBe('/workspace')
    expect(statementContaining(db, 'select workspace_path from sessions').get).toHaveBeenCalledWith(
      '/sessions/thread.jsonl'
    )
    store.close()
  })
})
