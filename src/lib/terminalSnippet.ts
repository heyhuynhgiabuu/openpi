/**
 * terminalSnippet — renderer-side store for the visible terminal's recent
 * output. The terminal panes publish; the workbench context bridge forwards
 * the latest snippet to main, where it feeds the steering context prefix.
 *
 * Publications are ownership-aware: the store remembers which pane last
 * published, and a pane's clear only applies when it still owns the snippet.
 * Tab switches re-run sibling panes' effects in creation order, so without
 * ownership a newly visible pane's publish can be clobbered by a hidden
 * sibling's clear.
 */

import { createSignal } from 'solid-js'

/** Hard cap so a chatty pane cannot balloon the context payload. */
export const MAX_SNIPPET_CHARS = 2_000

/** How many recent non-empty lines a snippet carries. */
export const SNIPPET_LINE_COUNT = 5

const [snippet, setSnippet] = createSignal<string | null>(null)
let owner: string | null = null

export function terminalSnippet(): string | null {
  return snippet()
}

export function publishTerminalSnippet(paneId: string, value: string | null): void {
  if (value !== null) {
    const trimmed = value.trim()
    if (trimmed) {
      owner = paneId
      setSnippet(trimmed.slice(-MAX_SNIPPET_CHARS))
    }
    return
  }
  if (owner === paneId) {
    owner = null
    setSnippet(null)
  }
}

/**
 * Reduces raw buffer lines (oldest first) to the last non-empty lines, newest
 * last. Leading and trailing empties are cursor/padding noise. Returns null
 * when nothing but empties remains.
 */
export function snippetFromLines(lines: string[]): string | null {
  let last = lines.length - 1
  while (last >= 0 && lines[last].trim() === '') last--
  if (last < 0) return null
  let first = 0
  while (first < last && lines[first].trim() === '') first++
  const from = Math.max(first, last - SNIPPET_LINE_COUNT + 1)
  return lines.slice(from, last + 1).join('\n')
}
