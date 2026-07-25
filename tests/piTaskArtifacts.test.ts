import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  findTaskIdForToolCall,
  readTaskSessionHistory,
  resolveSubSessionPath,
} from '../electron/services/piTaskArtifacts'
import { normalizeTaskHistoryStatus } from '../electron/services/piTaskStatus'

describe('pi-task JSON state helpers', () => {
  it('resolves a sub-session JSONL path by task id', () => {
    const dir = mkdtempSync(join(tmpdir(), 'openpi-task-artifacts-'))
    mkdirSync(join(dir, 'tasks', 'sessions', 'mqzjxmuo-6c34'), { recursive: true })
    writeFileSync(join(dir, 'tasks', 'sessions', 'mqzjxmuo-6c34', 'session.jsonl'), '{}\n')

    expect(resolveSubSessionPath(dir, 'mqzjxmuo-6c34')).toContain('session.jsonl')
  })

  it('resolves SDK background sessions from task history sessionRef', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'openpi-task-session-ref-'))
    const artifactsDir = join(cwd, '.pi', 'artifacts')
    const sessionPath = join(cwd, 'sdk-session.jsonl')
    mkdirSync(artifactsDir, { recursive: true })
    writeFileSync(sessionPath, '{}\n')
    writeFileSync(
      join(cwd, '.pi', 'task-session-history.json'),
      JSON.stringify([{ id: 'mqzjxmuo-6c34', sessionRef: sessionPath, status: 'done' }])
    )

    expect(resolveSubSessionPath(artifactsDir, 'mqzjxmuo-6c34')).toBe(sessionPath)
  })

  it('resolves the current live task id from matching task history', () => {
    const startedAt = Date.parse('2026-06-30T01:29:27.000Z')
    const resolved = findTaskIdForToolCall(
      [
        {
          id: 'mqzjxmuo-6c34',
          agentType: 'scout',
          description: 'Scan pi-diff repo',
          startedAt,
          status: 'running',
        },
      ],
      'scout',
      'Scan pi-diff repo',
      startedAt + 500
    )

    expect(resolved).toBe('mqzjxmuo-6c34')
  })

  it('keeps navigation-cancelled task history cancelled when the sub-session pane is gone', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'openpi-task-history-'))
    const taskId = 'mqzkaef0-9039'
    mkdirSync(join(cwd, '.pi', 'artifacts', 'sessions', taskId), { recursive: true })
    writeFileSync(
      join(cwd, '.pi', 'task-session-history.json'),
      JSON.stringify([{ id: taskId, status: 'cancelled', agentType: 'scout' }])
    )
    writeFileSync(
      join(cwd, '.pi', 'artifacts', 'sessions', taskId, 'session.jsonl'),
      `${JSON.stringify({
        type: 'message',
        message: { role: 'assistant', content: [{ type: 'text', text: 'working' }] },
      })}\n`
    )

    expect(readTaskSessionHistory(cwd)[0]?.status).toBe('cancelled')
  })

  it('normalizes navigation-cancelled task history to running while sub-session pane is alive', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'openpi-task-history-'))
    const taskId = 'mqzkaef0-9039'
    mkdirSync(join(cwd, '.pi', 'artifacts', 'sessions', taskId), { recursive: true })
    writeFileSync(
      join(cwd, '.pi', 'artifacts', 'sessions', taskId, 'session.jsonl'),
      `${JSON.stringify({
        type: 'message',
        message: { role: 'assistant', content: [{ type: 'text', text: 'working' }] },
      })}\n`
    )

    expect(
      normalizeTaskHistoryStatus(cwd, taskId, 'cancelled', '%12', (paneId) => paneId === '%12')
    ).toBe('running')
  })

  it('normalizes navigation-cancelled task history to done when sub-session has terminal stop', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'openpi-task-history-'))
    const taskId = 'mqzkaef0-9039'
    mkdirSync(join(cwd, '.pi', 'artifacts', 'sessions', taskId), { recursive: true })
    writeFileSync(
      join(cwd, '.pi', 'task-session-history.json'),
      JSON.stringify([{ id: taskId, status: 'cancelled', agentType: 'scout' }])
    )
    writeFileSync(
      join(cwd, '.pi', 'artifacts', 'sessions', taskId, 'session.jsonl'),
      `${JSON.stringify({
        type: 'message',
        message: { role: 'assistant', content: [], stopReason: 'stop' },
      })}\n`
    )

    expect(readTaskSessionHistory(cwd)[0]?.status).toBe('done')
  })

  it('does not fall back to stale matching task history outside the time window', () => {
    const staleStartedAt = Date.parse('2026-06-30T01:00:00.000Z')
    const currentStartedAt = staleStartedAt + 10 * 60 * 1000
    const resolved = findTaskIdForToolCall(
      [
        {
          id: 'mqzhz574-b765',
          agentType: 'explore',
          description: 'Scan pi-diff repo',
          startedAt: staleStartedAt,
          status: 'cancelled',
        },
      ],
      'explore',
      'Scan pi-diff repo',
      currentStartedAt
    )

    expect(resolved).toBeNull()
  })
})
