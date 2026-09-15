import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionListItem } from '../src/lib/ipc'
import { groupSessions } from '../src/lib/sessionView'

function session(overrides: Partial<SessionListItem> = {}): SessionListItem {
  return {
    path: '/tmp/sessions/a.jsonl',
    id: 'a',
    cwd: '/work/openpi',
    workspacePath: '/work/openpi',
    workspaceName: 'openpi',
    title: 'Fix the gate',
    createdAt: '2026-09-15T09:00:00.000Z',
    updatedAt: '2026-09-15T11:00:00.000Z',
    messageCount: 4,
    firstMessage: 'hello',
    parentSessionPath: null,
    inputTokens: 10,
    outputTokens: 20,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cost: 0.01,
    entryCount: 8,
    branchCount: 1,
    lastModel: 'claude-sonnet-4-5',
    active: false,
    ...overrides,
  }
}

describe('groupSessions by workspace', () => {
  it('keys by workspace path and labels by workspace name', () => {
    const groups = groupSessions(
      [
        session({ path: '/a.jsonl', workspacePath: '/work/openpi', workspaceName: 'openpi' }),
        session({ path: '/b.jsonl', workspacePath: '/work/site', workspaceName: 'site' }),
        session({ path: '/c.jsonl', workspacePath: '/work/openpi', workspaceName: 'openpi' }),
      ],
      'workspace'
    )

    expect(groups.map((g) => [g.key, g.label])).toEqual([
      ['/work/openpi', 'openpi'],
      ['/work/site', 'site'],
    ])
    expect(groups[0]?.sessions.map((s) => s.path)).toEqual(['/a.jsonl', '/c.jsonl'])
  })

  it('falls back to cwd, then to a literal placeholder, for the group key', () => {
    const fromCwd = groupSessions(
      [session({ workspacePath: '', cwd: '/work/from-cwd', workspaceName: 'from-cwd' })],
      'workspace'
    )
    expect(fromCwd[0]?.key).toBe('/work/from-cwd')

    const unknown = groupSessions(
      [session({ workspacePath: '', cwd: '', workspaceName: 'unknown' })],
      'workspace'
    )
    expect(unknown[0]?.key).toBe('unknown')
  })

  it('keeps first-seen order for the groups', () => {
    const groups = groupSessions(
      [
        session({ path: '/b.jsonl', workspacePath: '/work/site', workspaceName: 'site' }),
        session({ path: '/a.jsonl', workspacePath: '/work/openpi', workspaceName: 'openpi' }),
      ],
      'workspace'
    )

    expect(groups.map((g) => g.key)).toEqual(['/work/site', '/work/openpi'])
  })

  it('returns nothing for an empty list', () => {
    expect(groupSessions([], 'workspace')).toEqual([])
  })
})

describe('groupSessions by time', () => {
  // Local time on purpose: the buckets are calendar days, not elapsed hours.
  const now = new Date(2026, 8, 15, 12, 0, 0)

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const updated = (daysAgo: number) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, 12, 0, 0).toISOString()

  const at = (day: number, hour: number) =>
    new Date(now.getFullYear(), now.getMonth(), day, hour, 0, 0).toISOString()

  it('buckets sessions by how long ago they were touched', () => {
    const groups = groupSessions(
      [
        session({ path: '/today.jsonl', updatedAt: updated(0) }),
        session({ path: '/yesterday.jsonl', updatedAt: updated(1) }),
        session({ path: '/week.jsonl', updatedAt: updated(6) }),
        session({ path: '/month.jsonl', updatedAt: updated(7) }),
        session({ path: '/month-late.jsonl', updatedAt: updated(29) }),
        session({ path: '/old.jsonl', updatedAt: updated(30) }),
      ],
      'time'
    )

    expect(groups.map((g) => [g.key, g.label])).toEqual([
      ['Today', 'Today'],
      ['Yesterday', 'Yesterday'],
      ['This week', 'This week'],
      ['This month', 'This month'],
      ['Older', 'Older'],
    ])
    expect(groups.map((g) => g.sessions.map((s) => s.path))).toEqual([
      ['/today.jsonl'],
      ['/yesterday.jsonl'],
      ['/week.jsonl'],
      ['/month.jsonl', '/month-late.jsonl'],
      ['/old.jsonl'],
    ])
  })

  it('groups a session from earlier today with today, whatever the hour', () => {
    const groups = groupSessions([session({ updatedAt: at(15, 1) })], 'time')

    expect(groups[0]?.key).toBe('Today')
  })

  it('counts calendar days, so late last night is yesterday and not today', () => {
    const groups = groupSessions(
      [session({ updatedAt: at(15, 1) }), session({ updatedAt: at(14, 23) })],
      'time'
    )

    expect(groups.map((g) => [g.key, g.sessions.length])).toEqual([
      ['Today', 1],
      ['Yesterday', 1],
    ])
  })

  it('collects sessions in the same bucket together', () => {
    const groups = groupSessions(
      [
        session({ path: '/a.jsonl', updatedAt: updated(0) }),
        session({ path: '/b.jsonl', updatedAt: updated(0) }),
      ],
      'time'
    )

    expect(groups).toHaveLength(1)
    expect(groups[0]?.sessions.map((s) => s.path)).toEqual(['/a.jsonl', '/b.jsonl'])
  })
})
