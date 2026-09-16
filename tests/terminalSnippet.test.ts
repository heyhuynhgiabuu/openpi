import { describe, expect, it } from 'vitest'
import {
  MAX_SNIPPET_CHARS,
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
  it('publishes, trims, and clears the owner', () => {
    publishTerminalSnippet('pane-1', '  error: EACCES on ./secret  \n')
    expect(terminalSnippet()).toBe('error: EACCES on ./secret')

    publishTerminalSnippet('pane-1', null)
    expect(terminalSnippet()).toBeNull()
  })

  it('caps the snippet to the tail of the payload', () => {
    const noisy = Array.from({ length: 400 }, (_, i) => `row-${i}`).join('\n')
    publishTerminalSnippet('pane-1', noisy)

    const stored = terminalSnippet() ?? ''
    expect(stored.length).toBeLessThanOrEqual(MAX_SNIPPET_CHARS)
    expect(stored.endsWith('row-399')).toBe(true)
    expect(stored.startsWith('row-0')).toBe(false)
    publishTerminalSnippet('pane-1', null)
  })

  it('a hidden pane clearing must not silence the visible pane (tab switch-back)', () => {
    // Tab a→b: b publishes over a, then a's hide-cleanup must not clear b's.
    publishTerminalSnippet('pane-a', 'pane-a-output')
    publishTerminalSnippet('pane-b', 'pane-b-output')
    publishTerminalSnippet('pane-a', null)
    expect(terminalSnippet()).toBe('pane-b-output')

    // Tab b→a (the switch-back order that used to end in null): a publishes,
    // then b's hide-cleanup arrives; b no longer owns the snippet.
    publishTerminalSnippet('pane-a', 'pane-a-output-2')
    publishTerminalSnippet('pane-b', null)
    expect(terminalSnippet()).toBe('pane-a-output-2')

    publishTerminalSnippet('pane-a', null)
    expect(terminalSnippet()).toBeNull()
  })

  it('an empty publish neither takes nor steals ownership', () => {
    publishTerminalSnippet('pane-a', 'content')
    publishTerminalSnippet('pane-b', '   \n')
    expect(terminalSnippet()).toBe('content')

    // pane-b never owned the snippet, so its later clear is still ignored.
    publishTerminalSnippet('pane-b', null)
    expect(terminalSnippet()).toBe('content')
    publishTerminalSnippet('pane-a', null)
  })
})
