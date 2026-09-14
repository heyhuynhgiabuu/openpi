import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readCurrentBranchIds, readSessionHistoryPage } from '../electron/session/sessionEntries'
import { buildSessionTree } from '../electron/session/sessionTreeBuilder'

/**
 * A session file with one fork: root → user-a → assistant-a on the first
 * branch, then a second branch root → user-a → assistant-b (the file's last
 * entry). Pi's own leaf pointer is not stored in the file, so history either
 * follows the last entry or an explicit leaf the caller just switched to.
 */
const ENTRIES = [
  { type: 'session', version: 3, id: 'session-1', timestamp: '2026-09-14T00:00:00.000Z' },
  message('u-root', null, 'user', 'the original prompt'),
  message('u-a', 'u-root', 'user', 'first follow-up'),
  message('a-a', 'u-a', 'assistant', 'answer on the abandoned branch'),
  message('u-b', 'u-root', 'user', 'second follow-up'),
  message('a-b', 'u-b', 'assistant', 'answer on the current branch'),
]

function message(id: string, parentId: string | null, role: string, text: string) {
  return {
    type: 'message',
    id,
    parentId,
    timestamp: '2026-09-14T00:00:01.000Z',
    message: { role, content: [{ type: 'text', text }], timestamp: 1_758_000_000_000 },
  }
}

describe('session history along a chosen branch', () => {
  let tempDir: string
  let sessionFile: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-branch-history-'))
    sessionFile = path.join(tempDir, 'session.jsonl')
    fs.writeFileSync(sessionFile, `${ENTRIES.map((entry) => JSON.stringify(entry)).join('\n')}\n`)
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('follows the last entry in the file when no leaf is given', async () => {
    const page = await readSessionHistoryPage(sessionFile, { limit: 50 })

    expect(page.messages.map((entry) => entry.text)).toEqual([
      'the original prompt',
      'second follow-up',
      'answer on the current branch',
    ])
  })

  it('reads the abandoned branch when the caller passes its leaf', async () => {
    const page = await readSessionHistoryPage(sessionFile, { limit: 50, leafId: 'a-a' })

    expect(page.messages.map((entry) => entry.text)).toEqual([
      'the original prompt',
      'first follow-up',
      'answer on the abandoned branch',
    ])
  })

  it('walks from the root when the leaf is the first entry', async () => {
    const ids = await readCurrentBranchIds(sessionFile, 'u-root')

    expect([...ids]).toEqual(['u-root'])
  })

  it('marks the switched-to leaf as active in the session tree', () => {
    const defaultTree = buildSessionTree(sessionFile)
    expect(defaultTree.activeLeafId).toBe('a-b')

    const switched = buildSessionTree(sessionFile, 'a-a')
    expect(switched.activeLeafId).toBe('a-a')
    // Both branches are still listed; only the marker moves.
    expect(switched.branches.map((branch) => branch.leafId).sort()).toEqual(['a-a', 'a-b'])
  })

  it('falls back to the file leaf when the requested entry is not in the file', async () => {
    const ids = await readCurrentBranchIds(sessionFile, 'does-not-exist')

    expect(ids.has('a-b')).toBe(true)
    expect(ids.has('a-a')).toBe(false)
  })
})
