import { describe, expect, it } from 'vitest'
import type { GrepMatch } from '@ff-labs/fff-node'
import { grepMatchToResult } from '../electron/services/fffHost'

/**
 * The native library reports byte offsets with an exclusive end ("Byte offset
 * pairs [start, end] within lineContent for highlighting"), while the renderer
 * highlights inclusive character indices. These literals are copied from real
 * native output so the conversion stays pinned to it.
 */

function nativeMatch(overrides: Partial<GrepMatch> = {}): GrepMatch {
  return {
    relativePath: 'v.txt',
    fileName: 'v.txt',
    gitStatus: 'clean',
    size: 30,
    modified: 1789444680,
    isBinary: false,
    totalFrecencyScore: 0,
    accessFrecencyScore: 0,
    modificationFrecencyScore: 0,
    lineNumber: 1,
    col: 22,
    byteOffset: 0,
    lineContent: 'tiếng Việt đẹp 123 end',
    matchRanges: [[22, 25]],
    ...overrides,
  }
}

describe('grepMatchToResult', () => {
  it('converts native byte ranges to the character range the renderer slices', () => {
    const result = grepMatchToResult(nativeMatch())
    expect(result.matchRanges).toEqual([[15, 17]])
    // Exactly what HighlightedText renders.
    expect(result.lineContent.slice(15, 18)).toBe('123')
  })

  it('keeps the range correct for an ascii line', () => {
    const result = grepMatchToResult(
      nativeMatch({ lineContent: 'abc 123 def', matchRanges: [[4, 7]], col: 4 })
    )
    expect(result.matchRanges).toEqual([[4, 6]])
    expect(result.lineContent.slice(4, 7)).toBe('123')
  })

  it('passes the identifying fields through', () => {
    const result = grepMatchToResult(
      nativeMatch({ relativePath: 'src/a.ts', fileName: 'a.ts', lineNumber: 7 })
    )
    expect(result.relativePath).toBe('src/a.ts')
    expect(result.fileName).toBe('a.ts')
    expect(result.lineNumber).toBe(7)
  })

  it('takes the range from matchRanges, not from the byte column', () => {
    // `col` is the match start in bytes; it is not the highlight range.
    const result = grepMatchToResult(
      nativeMatch({ lineContent: 'abc 123 def', matchRanges: [[4, 7]], col: 99 })
    )
    expect(result.matchRanges).toEqual([[4, 6]])
  })

  it('handles a hit with no ranges', () => {
    const result = grepMatchToResult(nativeMatch({ matchRanges: [] }))
    expect(result.matchRanges).toEqual([])
  })
})
