import { describe, expect, it, vi } from 'vitest'
import { deleteMissingSessions } from '../electron/session/sessionQueries'

interface PreparedStatement {
  sql: string
  run: ReturnType<typeof vi.fn>
}

function createDb() {
  const statements: PreparedStatement[] = []
  const db = {
    prepare: vi.fn((sql: string) => {
      const statement = { sql, run: vi.fn() }
      statements.push(statement)
      return statement
    }),
  }
  return { db, statements }
}

function asDeleteDb(
  db: ReturnType<typeof createDb>['db']
): Parameters<typeof deleteMissingSessions>[0] {
  return db as unknown as Parameters<typeof deleteMissingSessions>[0]
}

describe('deleteMissingSessions', () => {
  it('limits stale cleanup to the refreshed workspace', () => {
    const { db, statements } = createDb()

    deleteMissingSessions(asDeleteDb(db), new Set(['/sessions/a.jsonl']), '/work/a')

    const statement = statements[0]
    expect(statement).toBeDefined()
    if (!statement) throw new Error('Expected delete statement')
    expect(statement.sql).toBe('delete from sessions where path not in (?) and workspace_path = ?')
    expect(statement.run).toHaveBeenCalledWith('/sessions/a.jsonl', '/work/a')
  })

  it('keeps global cleanup unscoped for full refreshes', () => {
    const { db, statements } = createDb()

    deleteMissingSessions(asDeleteDb(db), new Set(['/sessions/a.jsonl', '/sessions/b.jsonl']))

    const statement = statements[0]
    expect(statement).toBeDefined()
    if (!statement) throw new Error('Expected delete statement')
    expect(statement.sql).toBe('delete from sessions where path not in (?,?)')
    expect(statement.run).toHaveBeenCalledWith('/sessions/a.jsonl', '/sessions/b.jsonl')
  })

  it('removes only scoped workspace rows when the workspace has no sessions left', () => {
    const { db, statements } = createDb()

    deleteMissingSessions(asDeleteDb(db), new Set(), '/work/a')

    const statement = statements[0]
    expect(statement).toBeDefined()
    if (!statement) throw new Error('Expected delete statement')
    expect(statement.sql).toBe('delete from sessions where workspace_path = ?')
    expect(statement.run).toHaveBeenCalledWith('/work/a')
  })
})
