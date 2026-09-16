import { describe, expect, it } from 'vitest'
import {
  publishTerminalSnippet,
  SNIPPET_LINE_COUNT,
  snippetFromLines,
  terminalSnippet,
} from '../src/lib/terminalSnippet'

describe('snippetFromLines', () => {
  it('keeps the last non-empty lines, newest last', () => {
    const lines = ['a', 'b', '', 'c', 'd', 'e', 'f', 'g', '', '']
    expect(snippetFromLines(lines)).toBe('c\nd\ne\nf\ng')
  })

  it('returns fewer lines when the buffer has fewer non-empty ones', () => {
    expect(snippetFromLines(['', 'hello', ''])).toBe('hello')
    expect(snippetFromLines(['one'])).toBe('one')
  })

  it('returns null when only empties remain', () => {
    expect(snippetFromLines(['', '', ''])).toBeNull()
    expect(snippetFromLines([])).toBeNull()
  })

  it('caps at the documented line count', () => {
    const lines = Array.from({ length: SNIPPET_LINE_COUNT + 3 }, (_, i) => `line-${i}`)
    const snippet = snippetFromLines(lines) ?? ''
    expect(snippet.split('\n')).toHaveLength(SNIPPET_LINE_COUNT)
    expect(snippet.endsWith(`line-${lines.length - 1}`)).toBe(true)
  })
})

describe('terminalSnippet store', () => {
  it('publishes, trims, and clears', () => {
    publishTerminalSnippet('  error: EACCES on ./secret  \n')
    expect(terminalSnippet()).toBe('error: EACCES on ./secret')

    publishTerminalSnippet(null)
    expect(terminalSnippet()).toBeNull()
  })

  it('caps the snippet to the tail of the payload', () => {
    const noisy = Array.from({ length: 400 }, (_, i) => `row-${i}`).join('\n')
    publishTerminalSnippet(noisy)

    const stored = terminalSnippet() ?? ''
    expect(stored.length).toBeLessThanOrEqual(2000)
    expect(stored.endsWith('row-399')).toBe(true)
    expect(stored.startsWith('row-0')).toBe(false)
  })
})
