import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fallbackFileSearch, fallbackGrep } from '../electron/services/fffFallback'

/**
 * `fffFallback` runs whenever `@ff-labs/fff-node` cannot be imported (packaged
 * app, missing dylib) and whenever a native search returns nothing, so its
 * options have to mean the same thing as the native ones.
 */

let dir = ''

function write(relPath: string, content: string): void {
  const full = path.join(dir, relPath)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content)
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-fff-'))
  write('a.txt', 'needle one\nneedle two\nneedle three\n')
  write('sub/b.txt', 'plain\n')
  write('digits.txt', 'abc 123 def\nliteral \\d+ here\n')
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('fallbackGrep', () => {
  it('returns nothing without a cwd or a query', () => {
    expect(fallbackGrep(null, 'needle', {})).toEqual([])
    expect(fallbackGrep(dir, 'needle', {}).map((h) => h.lineNumber)).toEqual([1, 2, 3])
  })

  it('searches the query literally in plain mode', () => {
    const hits = fallbackGrep(dir, '\\d+', { mode: 'plain' })
    expect(hits.map((h) => h.lineNumber)).toEqual([2])
    expect(hits[0]?.lineContent).toBe('literal \\d+ here')
  })

  it('searches the query as a regex in regex mode', () => {
    // Plain mode matched the pattern's own text and missed the real digits.
    const hits = fallbackGrep(dir, '\\d+', { mode: 'regex' })
    expect(hits.map((h) => h.lineNumber)).toEqual([1])
    expect(hits[0]?.lineContent).toBe('abc 123 def')
    expect(hits[0]?.matchRanges).toEqual([[4, 6]])
  })

  it('reports nothing for an invalid regex instead of throwing', () => {
    expect(fallbackGrep(dir, 'a(b', { mode: 'regex' })).toEqual([])
  })

  it('honours maxMatchesPerFile', () => {
    // The default matches the native host's default of five.
    expect(fallbackGrep(dir, 'needle', { mode: 'plain' })).toHaveLength(3)
    const all = fallbackGrep(dir, 'needle', { mode: 'plain', maxMatchesPerFile: 5 })
    expect(all.map((h) => h.lineNumber)).toEqual([1, 2, 3])
    expect(fallbackGrep(dir, 'needle', { mode: 'plain', maxMatchesPerFile: 2 })).toHaveLength(2)
  })

  it('reports inclusive character ranges for each match', () => {
    const [first] = fallbackGrep(dir, 'two', { mode: 'plain' })
    expect(first?.lineNumber).toBe(2)
    expect(first?.lineContent).toBe('needle two')
    expect(first?.lineContent.slice(7, 10)).toBe('two')
    expect(first?.matchRanges).toEqual([[7, 9]])
  })

  it('skips a zero-length regex match instead of highlighting nothing', () => {
    // `\d*` matches the empty string at every position; only real digits count.
    const hits = fallbackGrep(dir, '\\d*', { mode: 'regex' })
    expect(hits.map((h) => h.lineContent)).toEqual(['abc 123 def'])
    expect(hits[0]?.matchRanges).toEqual([[4, 6]])
  })

  it('follows smart-case: an uppercase query is case-sensitive', () => {
    // The modal sends smartCase: !matchCase, so `true` means "ignore case
    // unless the query has uppercase" and `false` means "match case exactly".
    write('mixed.txt', 'Needle capital\n')
    expect(fallbackGrep(dir, 'needle', { mode: 'plain', smartCase: true })).toHaveLength(4)
    expect(fallbackGrep(dir, 'needle', { mode: 'plain', smartCase: false })).toHaveLength(3)
    expect(fallbackGrep(dir, 'Needle', { mode: 'plain', smartCase: true })).toHaveLength(1)
    expect(fallbackGrep(dir, 'NEEDLE', { mode: 'plain', smartCase: true })).toEqual([])
  })

  it('searches fuzzy mode literally, since it cannot rank fuzzy hits', () => {
    expect(fallbackGrep(dir, '\\d+', { mode: 'fuzzy' })).toHaveLength(1)
    expect(fallbackGrep(dir, '\\d+', { mode: 'fuzzy' })[0]?.lineContent).toBe('literal \\d+ here')
  })

  it('stops at five matches per file by default', () => {
    write('many.txt', Array.from({ length: 8 }, (_, i) => `needle ${i}`).join('\n'))
    expect(
      fallbackGrep(dir, 'needle', { mode: 'plain' }).filter((h) => h.relativePath === 'many.txt')
    ).toHaveLength(5)
  })

  it('restarts the pattern for every file', () => {
    // A shared matcher left mid-file would drop the next file's first hits.
    write('many.txt', Array.from({ length: 8 }, (_, i) => `needle ${i}`).join('\n'))
    write('z-first.txt', 'needle first\nneedle second\n')
    const hits = fallbackGrep(dir, 'needle', { mode: 'plain', maxMatchesPerFile: 5 })
    expect(hits.filter((h) => h.relativePath === 'z-first.txt').map((h) => h.lineNumber)).toEqual([
      1, 2,
    ])
  })

  it('skips files above the native size cap', () => {
    const big = 'x'.repeat(10_000_001) + '\nneedle\n'
    write('big.txt', big)
    expect(
      fallbackGrep(dir, 'needle', { mode: 'plain' }).some((h) => h.relativePath === 'big.txt')
    ).toBe(false)
  })

  it('defaults to smart-case when the caller omits it', () => {
    write('mixed.txt', 'Needle capital\n')
    expect(fallbackGrep(dir, 'needle', { mode: 'plain' })).toHaveLength(4)
  })

  it('stops the walk when the time budget is exhausted', () => {
    // A zero budget must not walk at all, rather than searching the whole tree.
    expect(fallbackGrep(dir, 'needle', { mode: 'plain', timeBudgetMs: 0 })).toEqual([])
  })

  it('skips ignored directories, dot paths and binary files', () => {
    write('node_modules/pkg/ignored.txt', 'needle\n')
    write('.hidden.txt', 'needle\n')
    write('binary.bin', 'needle\0needle\n')
    const hits = fallbackGrep(dir, 'needle', { mode: 'plain', maxMatchesPerFile: 5 })
    expect(hits.map((h) => h.relativePath)).toEqual(['a.txt', 'a.txt', 'a.txt'])
  })

  it('names the file and keeps paths workspace-relative', () => {
    write('deep/nested/c.txt', 'needle\n')
    const hit = fallbackGrep(dir, 'needle', { mode: 'plain' }).find((h) =>
      h.relativePath.includes('deep')
    )
    expect(hit?.relativePath).toBe('deep/nested/c.txt')
    expect(hit?.fileName).toBe('c.txt')
  })
})

describe('fallbackFileSearch', () => {
  it('returns nothing without a cwd', () => {
    expect(fallbackFileSearch(null, 'a', 10)).toEqual([])
  })

  it('matches on the path, not the contents', () => {
    expect(fallbackFileSearch(dir, 'needle', 10)).toEqual([])
    expect(fallbackFileSearch(dir, 'a.txt', 10).map((f) => f.relativePath)).toEqual(['a.txt'])
  })

  it('ranks an exact name above a prefix and a prefix above a substring', () => {
    write('other/b.txt', '')
    write('deep/b.txt.bak', '')
    const results = fallbackFileSearch(dir, 'b.txt', 10)
    expect(results[0]?.relativePath).toBe('sub/b.txt')
    expect(results.map((f) => f.relativePath)).toContain('other/b.txt')
  })

  it('respects the page size and fills in dir/fileName', () => {
    const results = fallbackFileSearch(dir, '.txt', 2)
    expect(results).toHaveLength(2)
    expect(results[0]?.dir).toBe('')
    expect(results[0]?.fileName.endsWith('.txt')).toBe(true)
  })

  it('skips ignored directories and dot paths', () => {
    write('node_modules/pkg/dep.txt', '')
    write('.secret.txt', '')
    const paths = fallbackFileSearch(dir, '.txt', 50).map((f) => f.relativePath)
    expect(paths).not.toContain('node_modules/pkg/dep.txt')
    expect(paths).not.toContain('.secret.txt')
  })
})
