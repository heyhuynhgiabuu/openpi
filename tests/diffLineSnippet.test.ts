import { describe, expect, it } from 'vitest'
import { buildDiffLineSnippet } from '../src/lib/diffLineSnippet'

describe('buildDiffLineSnippet', () => {
  const text = 'one\ntwo\nthree\nfour\nfive\nsix'

  it('returns the lines in the selected range, capped to maxLines', () => {
    expect(buildDiffLineSnippet({ text, startLine: 2, endLine: 5, maxLines: 2 })).toBe('two\nthree')
  })

  it('handles reversed ranges', () => {
    expect(buildDiffLineSnippet({ text, startLine: 5, endLine: 2, maxLines: 4 })).toBe(
      'two\nthree\nfour\nfive'
    )
  })

  it('returns empty string for missing text', () => {
    expect(buildDiffLineSnippet({ text: null, startLine: 1, endLine: 1 })).toBe('')
  })

  it('returns empty string for out-of-range selection', () => {
    expect(buildDiffLineSnippet({ text, startLine: 50, endLine: 60 })).toBe('')
  })
})
