/**
 * sessionTrajectory.test.ts — the ledger builder must show only the branch the
 * session is currently on, in conversation order, with the indexer's per-entry
 * usage merged in and entry ids preserved for deep-linking.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildSessionTrajectory } from '../electron/session/sessionTrajectory'

const tmpDirs: string[] = []

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function writeSession(lines: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trajectory-'))
  tmpDirs.push(dir)
  const file = path.join(dir, 'session.jsonl')
  fs.writeFileSync(file, lines.join('\n'))
  return file
}

const header = JSON.stringify({ type: 'session', id: 'sess-1', cwd: '/ws' })
const userEntry = JSON.stringify({
  type: 'message',
  id: 'u1',
  parentId: null,
  timestamp: '2026-09-15T10:00:00.000Z',
  message: { role: 'user', content: 'inspect the fixture module' },
})
const assistantEntry = JSON.stringify({
  type: 'message',
  id: 'a1',
  parentId: 'u1',
  timestamp: '2026-09-15T10:00:05.000Z',
  message: {
    role: 'assistant',
    content: [{ type: 'text', text: 'Reading fixture module' }],
    usage: {
      input: 1200,
      output: 340,
      cacheRead: 50,
      cacheWrite: 0,
      totalTokens: 1590,
      cost: { total: 0.0042, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
    provider: 'test-provider',
    model: 'test-model',
  },
})
const modelChange = JSON.stringify({
  type: 'model_change',
  id: 'mc1',
  parentId: 'a1',
  timestamp: '2026-09-15T10:00:06.000Z',
  modelId: 'next-model',
})
const compaction = JSON.stringify({
  type: 'compaction',
  id: 'c1',
  parentId: 'mc1',
  timestamp: '2026-09-15T10:00:07.000Z',
  reason: 'threshold',
  result: { tokensBefore: 90000, summary: 'context summarized' },
})
const branchA = JSON.stringify({
  type: 'message',
  id: 'ba1',
  parentId: 'c1',
  timestamp: '2026-09-15T10:00:08.000Z',
  message: { role: 'assistant', content: [{ type: 'text', text: 'branch A answer' }] },
})
const branchB = JSON.stringify({
  type: 'message',
  id: 'bb1',
  parentId: 'c1',
  timestamp: '2026-09-15T10:00:09.000Z',
  message: { role: 'assistant', content: [{ type: 'text', text: 'branch B answer' }] },
})

describe('buildSessionTrajectory', () => {
  it('shows only the current branch, in conversation order, with usage merged', () => {
    const file = writeSession([
      header,
      userEntry,
      assistantEntry,
      modelChange,
      compaction,
      branchA,
      branchB,
    ])

    const result = buildSessionTrajectory(file, 'bb1')
    expect(result.activeLeafId).toBe('bb1')
    expect(result.rows.map((row) => row.entryId)).toEqual(['u1', 'a1', 'mc1', 'c1', 'bb1'])
    expect(result.rows[0]?.role).toBe('user')
    expect(result.rows[0]?.preview).toBe('inspect the fixture module')

    const assistant = result.rows[1]
    expect(assistant).toMatchObject({
      navigable: true,
      model: 'test-model',
      provider: 'test-provider',
      inputTokens: 1200,
      outputTokens: 340,
      cacheReadTokens: 50,
      totalTokens: 1590,
      durationMs: 5000,
      cost: 0.0042,
    })

    // The abandoned branch is absent.
    expect(result.rows.some((row) => row.entryId === 'ba1')).toBe(false)
  })

  it('marks non-message metadata rows as non-navigable', () => {
    const file = writeSession([header, userEntry, assistantEntry, modelChange, compaction, branchB])
    const result = buildSessionTrajectory(file)
    const compactionRow = result.rows.find((row) => row.type === 'compaction')
    expect(compactionRow?.navigable).toBe(false)
    expect(compactionRow?.freedTokens).toBe(90000)
    const modelRow = result.rows.find((row) => row.type === 'model_change')
    expect(modelRow?.model).toBe('next-model')
    expect(modelRow?.navigable).toBe(false)
  })

  it('falls back to the file leaf when the leaf id is unknown', () => {
    const file = writeSession([header, userEntry, branchA, branchB])
    const result = buildSessionTrajectory(file, 'not-a-real-id')
    expect(result.rows.at(-1)?.entryId).toBe('bb1')
  })

  it('returns empty rows for an empty or unreadable file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trajectory-empty-'))
    tmpDirs.push(dir)
    expect(buildSessionTrajectory(path.join(dir, 'none.jsonl')).rows).toEqual([])
    const file = writeSession([header])
    expect(buildSessionTrajectory(file).rows).toEqual([])
  })
})
