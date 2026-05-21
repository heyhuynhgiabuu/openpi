import { describe, expect, it } from 'vitest'
import { collectCodeSearchMatches, isValidCodeSearchQuery } from '../src/lib/codeSearch'

describe('codeSearch', () => {
  it('collects case-insensitive literal matches', () => {
    expect(collectCodeSearchMatches({ text: 'Index index', query: 'index' })).toEqual([
      { index: 0, length: 5 },
      { index: 6, length: 5 },
    ])
  })

  it('honors case sensitivity', () => {
    expect(
      collectCodeSearchMatches({ text: 'Index index', query: 'index', caseSensitive: true })
    ).toEqual([{ index: 6, length: 5 }])
  })

  it('honors whole-word matching', () => {
    expect(
      collectCodeSearchMatches({ text: 'cat catalog cat', query: 'cat', wholeWord: true })
    ).toEqual([
      { index: 0, length: 3 },
      { index: 12, length: 3 },
    ])
  })

  it('supports regex search and rejects invalid regex queries', () => {
    expect(collectCodeSearchMatches({ text: 'a1 a22', query: 'a\\d+', regex: true })).toEqual([
      { index: 0, length: 2 },
      { index: 3, length: 3 },
    ])
    expect(isValidCodeSearchQuery({ text: 'abc', query: '[', regex: true })).toBe(false)
  })

  it('limits results to the requested range', () => {
    expect(collectCodeSearchMatches({ text: 'one one one', query: 'one', from: 4, to: 7 })).toEqual(
      [{ index: 4, length: 3 }]
    )
  })
})
