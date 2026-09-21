import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('better-sqlite3', async () => {
  const { createSqliteShim } = await import('./helpers/sqliteShim')
  return createSqliteShim()
})

import { getDefaultSessionDir, listSessionInfos } from '../electron/session/sessionEntries'
import { SessionIndexStore } from '../electron/session/sessionIndex'

let homeDir: string
let previousHome: string | undefined

beforeEach(() => {
  previousHome = process.env.HOME
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-index-'))
  process.env.HOME = homeDir
})

afterEach(() => {
  if (previousHome === undefined) delete process.env.HOME
  else process.env.HOME = previousHome
  fs.rmSync(homeDir, { recursive: true, force: true })
})

function writeSession(cwd: string): string {
  const sessionDir = getDefaultSessionDir(cwd)
  fs.mkdirSync(sessionDir, { recursive: true })
  const sessionPath = path.join(sessionDir, 'session.jsonl')
  const timestamp = '2026-01-01T00:00:00.000Z'
  const entries = [
    {
      type: 'session',
      version: 3,
      id: 'session-1',
      cwd,
      timestamp,
    },
    {
      type: 'message',
      id: 'system-1',
      parentId: null,
      timestamp,
      message: { role: 'system', content: 'system metadata' },
    },
    {
      type: 'message',
      id: 'user-1',
      parentId: 'system-1',
      timestamp,
      message: { role: 'user', content: 'hello' },
    },
    {
      type: 'message',
      id: 'assistant-1',
      parentId: 'user-1',
      timestamp,
      message: {
        role: 'assistant',
        model: 'fixture-model',
        provider: 'fixture-provider',
        usage: { input: 10, output: 5, cost: { total: 0.1 } },
        content: 'hi',
      },
    },
    {
      type: 'message',
      id: 'tool-1',
      parentId: 'assistant-1',
      timestamp,
      message: {
        role: 'toolResult',
        usage: { input: 20, output: 2, cost: { total: 0.2 } },
        content: 'tool output',
      },
    },
    {
      type: 'usage',
      id: 'warm-1',
      parentId: 'assistant-1',
      timestamp,
      model: 'fixture-model',
      provider: 'fixture-provider',
      usage: { input: 30, cost: { total: 0.3 } },
    },
  ]
  fs.writeFileSync(sessionPath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`)
  return sessionPath
}

describe('SessionIndexStore usage accounting', () => {
  it('persists role-aware rows and assistant-only turn counts through refresh', async () => {
    const workspacePath = path.join(homeDir, 'workspace')
    fs.mkdirSync(workspacePath)
    const cwd = fs.realpathSync.native(workspacePath)
    const sessionPath = writeSession(cwd)
    expect(listSessionInfos(cwd)).toHaveLength(1)
    const store = new SessionIndexStore(path.join(homeDir, 'index.sqlite'))

    try {
      await store.refreshSessions(null, cwd)

      const rows = store.database
        .prepare(
          'select entry_id, type, total_tokens, cost from session_entries where session_path = ? order by entry_id'
        )
        .all(sessionPath) as Array<{
        entry_id: string
        type: string
        total_tokens: number
        cost: number
      }>
      expect(rows.map((row) => [row.entry_id, row.type])).toEqual([
        ['assistant-1', 'message'],
        ['system-1', 'system'],
        ['tool-1', 'tool_result'],
        ['user-1', 'user'],
        ['warm-1', 'usage'],
      ])
      expect(rows.reduce((total, row) => total + row.total_tokens, 0)).toBe(67)
      expect(rows.reduce((total, row) => total + row.cost, 0)).toBeCloseTo(0.6)

      const lifetime = store.getUsageSummary().lifetime
      expect(lifetime.turnCount).toBe(1)
      expect(lifetime.totalTokens).toBe(67)
      expect(lifetime.cost).toBeCloseTo(0.6)
    } finally {
      store.close()
    }
  })
})
