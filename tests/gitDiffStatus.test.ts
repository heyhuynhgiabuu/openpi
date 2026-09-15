import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { effectiveStatus, resolveGitDir, timestampFromDate } from '../electron/git/gitDiffStatus'

describe('effectiveStatus', () => {
  it('prefers the staged code over the working directory code', () => {
    expect(effectiveStatus('M', ' ')).toBe('M')
    expect(effectiveStatus('M', 'D')).toBe('M')
    expect(effectiveStatus('A', 'M')).toBe('A')
    expect(effectiveStatus('D', ' ')).toBe('D')
    expect(effectiveStatus('R', ' ')).toBe('R')
  })

  it('falls back to the working directory code when nothing is staged', () => {
    expect(effectiveStatus(' ', 'M')).toBe('M')
    expect(effectiveStatus(' ', 'D')).toBe('D')
    expect(effectiveStatus('', 'D')).toBe('D')
  })

  it('keeps an untracked file untracked, which git reports as ?? on both sides', () => {
    expect(effectiveStatus('?', '?')).toBe('?')
  })

  it('reports a conflict whichever side carries it', () => {
    expect(effectiveStatus('U', ' ')).toBe('U')
    expect(effectiveStatus(' ', 'U')).toBe('U')
    expect(effectiveStatus('U', 'U')).toBe('U')
  })

  it('reports a working directory code git does not model as modified', () => {
    expect(effectiveStatus(' ', 'T')).toBe('M')
    expect(effectiveStatus('C', ' ')).toBe('M')
  })

  it('never returns a code outside the schema union', () => {
    const codes = [' ', '?', '', 'M', 'A', 'D', 'R', 'U', 'T', 'C']
    const allowed = new Set(['M', 'A', 'D', 'R', '?', 'U'])
    for (const index of codes) {
      for (const working of codes) expect(allowed.has(effectiveStatus(index, working))).toBe(true)
    }
  })
})

describe('timestampFromDate', () => {
  it('reads a Date and an ISO string', () => {
    const date = new Date('2026-09-15T10:00:00.000Z')
    expect(timestampFromDate(date)).toBe(date.getTime())
    expect(timestampFromDate('2026-09-15T10:00:00.000Z')).toBe(date.getTime())
  })

  it('returns null for missing or unparseable values', () => {
    expect(timestampFromDate(null)).toBeNull()
    expect(timestampFromDate(undefined)).toBeNull()
    expect(timestampFromDate('')).toBeNull()
    expect(timestampFromDate('not a date')).toBeNull()
  })
})

describe('resolveGitDir', () => {
  it('keeps an absolute path', () => {
    expect(resolveGitDir('/work/repo', '/work/repo/.git')).toBe('/work/repo/.git')
  })

  it('resolves the relative path git prints at the repository root', () => {
    // Built with the platform's own separator: `path.resolve` on Windows
    // returns drive-qualified backslashes, so a POSIX literal cannot match.
    const cwd = path.join(os.tmpdir(), 'repo')

    expect(resolveGitDir(cwd, '.git')).toBe(path.join(cwd, '.git'))
    expect(resolveGitDir(cwd, '.git/worktrees/wt')).toBe(path.join(cwd, '.git', 'worktrees', 'wt'))
  })
})
