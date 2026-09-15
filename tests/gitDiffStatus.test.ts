import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  countContentLines,
  countDiffLines,
  effectiveStatus,
  resolveGitDir,
  timestampFromDate,
} from '../electron/git/gitDiffStatus'

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

describe('countContentLines', () => {
  it('counts a file without a trailing newline', () => {
    expect(countContentLines('one')).toBe(1)
    expect(countContentLines('one\ntwo')).toBe(2)
  })

  it('does not count the empty string after a trailing newline', () => {
    expect(countContentLines('one\n')).toBe(1)
    expect(countContentLines('one\ntwo\n')).toBe(2)
    expect(countContentLines('\n')).toBe(1)
  })

  it('counts blank lines inside the file', () => {
    expect(countContentLines('one\n\ntwo\n')).toBe(3)
    expect(countContentLines('one\n\n')).toBe(2)
  })

  it('handles CRLF', () => {
    expect(countContentLines('one\r\ntwo\r\n')).toBe(2)
    expect(countContentLines('\r\n')).toBe(1)
  })

  it('returns zero for empty contents', () => {
    expect(countContentLines('')).toBe(0)
  })
})

describe('countDiffLines', () => {
  const patch = [
    'diff --git a/src/app.ts b/src/app.ts',
    'index 1111111..2222222 100644',
    '--- a/src/app.ts',
    '+++ b/src/app.ts',
    '@@ -1,3 +1,4 @@',
    ' context',
    '-removed line',
    '+added line',
    '+another added line',
  ].join('\n')

  it('counts content lines and skips the file headers', () => {
    expect(countDiffLines(patch)).toEqual({ added: 2, removed: 1 })
  })

  it('counts a removed markdown rule, whose diff line starts with four dashes', () => {
    const markdown = ['--- a/README.md', '+++ b/README.md', '@@ -1 +0,0 @@', '----'].join('\n')

    expect(countDiffLines(markdown)).toEqual({ added: 0, removed: 1 })
  })

  it('counts an added line that starts with the header prefix', () => {
    const added = ['--- a/README.md', '+++ b/README.md', '@@ -0,0 +1 @@', '++++ not a header'].join(
      '\n'
    )

    expect(countDiffLines(added)).toEqual({ added: 1, removed: 0 })
  })

  it('ignores hunk headers, modes and rename metadata', () => {
    const meta = [
      'diff --git a/old.ts b/new.ts',
      'similarity index 95%',
      'rename from old.ts',
      'rename to new.ts',
      'new file mode 100644',
      '@@ -1 +1 @@',
      '\\ No newline at end of file',
    ].join('\n')

    expect(countDiffLines(meta)).toEqual({ added: 0, removed: 0 })
  })

  it('counts a whole-file addition', () => {
    const newFile = [
      'diff --git a/new.ts b/new.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/new.ts',
      '@@ -0,0 +1,2 @@',
      '+one',
      '+two',
    ].join('\n')

    expect(countDiffLines(newFile)).toEqual({ added: 2, removed: 0 })
  })

  it('counts a whole-file deletion', () => {
    const deleted = [
      'diff --git a/gone.ts b/gone.ts',
      'deleted file mode 100644',
      '--- a/gone.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-one',
      '-two',
    ].join('\n')

    expect(countDiffLines(deleted)).toEqual({ added: 0, removed: 2 })
  })

  it('returns zeroes for an empty patch', () => {
    expect(countDiffLines('')).toEqual({ added: 0, removed: 0 })
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
