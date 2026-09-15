import { describe, expect, it } from 'vitest'
import { byteRangeToInclusiveChars } from '../electron/services/fffRanges'

/**
 * `@ff-labs/fff-node` reports byte offsets with an exclusive end; the renderer
 * highlights inclusive character indices. These cases are taken from real
 * native output so the conversion stays pinned to what the library returns.
 */

describe('byteRangeToInclusiveChars', () => {
  it('converts an ascii range', () => {
    // Native: grep '123' in 'abc 123 def' -> [[4, 7]]
    expect(byteRangeToInclusiveChars('abc 123 def', [4, 7])).toEqual([4, 6])
    expect('abc 123 def'.slice(4, 7)).toBe('123')
  })

  it('converts a range after multi-byte characters', () => {
    // Native: grep '123' in this line -> [[22, 25]]; the character index is 15,
    // so passing byte offsets straight to the renderer highlighted the wrong span.
    const line = 'tiếng Việt đẹp 123 end'
    expect(byteRangeToInclusiveChars(line, [22, 25])).toEqual([15, 17])
    expect(line.slice(15, 18)).toBe('123')
  })

  it('converts a range at the start of the line', () => {
    expect(byteRangeToInclusiveChars('ngắn thôi', [0, 4])).toEqual([0, 2])
    expect('ngắn thôi'.slice(0, 3)).toBe('ngắ')
  })

  it('converts a range that covers the whole line', () => {
    const line = 'hết rồi'
    const bytes = Buffer.byteLength(line, 'utf8')
    expect(byteRangeToInclusiveChars(line, [0, bytes])).toEqual([0, line.length - 1])
  })

  it('counts a surrogate pair as its four utf-8 bytes', () => {
    const line = '😀 x'
    expect(byteRangeToInclusiveChars(line, [0, 4])).toEqual([0, 1])
    expect(line.slice(0, 2)).toBe('😀')
  })

  it('advances by code unit for an astral character before the match', () => {
    // The surrogate pair spans two code units, so the match starts at 3.
    expect(byteRangeToInclusiveChars('😀 123 end', [5, 8])).toEqual([3, 5])
    expect('😀 123 end'.slice(3, 6)).toBe('123')
  })

  it('counts a two-byte character before the match', () => {
    expect(byteRangeToInclusiveChars('é 123', [3, 6])).toEqual([2, 4])
    expect('é 123'.slice(2, 5)).toBe('123')
  })

  it('treats a lossy replacement character as the single byte it came from', () => {
    // A latin-1 file read as utf-8: 0xe9 decodes to U+FFFD but is one byte, so
    // the native offsets still line up.
    const line = Buffer.from([0xe9, 0x20, 0x31, 0x32, 0x33]).toString('utf8')
    expect(line).toBe('\ufffd 123')
    expect(byteRangeToInclusiveChars(line, [2, 5])).toEqual([2, 4])
    expect(line.slice(2, 5)).toBe('123')
  })

  it('does not invert a range that ends inside a character', () => {
    // 'ế' occupies bytes 0-2; a byte end of 2 lands inside it.
    expect(byteRangeToInclusiveChars('ế', [0, 2])).toEqual([0, 0])
  })

  it('clamps a range beyond the line instead of returning junk', () => {
    expect(byteRangeToInclusiveChars('abc', [99, 120])).toEqual([3, 3])
  })

  it('handles an empty line', () => {
    expect(byteRangeToInclusiveChars('', [0, 0])).toEqual([0, 0])
  })
})
