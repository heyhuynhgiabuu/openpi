/**
 * terminalSnippet — renderer-side store for the visible terminal's recent
 * output. The terminal panes publish; the workbench context bridge forwards
 * the latest snippet to main, where it feeds the steering context prefix.
 */

import { createSignal } from 'solid-js'

/** Hard cap so a chatty pane cannot balloon the context payload. */
const MAX_SNIPPET_CHARS = 2_000

/** How many recent non-empty lines a snippet carries. */
export const SNIPPET_LINE_COUNT = 5

const [snippet, setSnippet] = createSignal<string | null>(null)

export function terminalSnippet(): string | null {
  return snippet()
}

export function publishTerminalSnippet(value: string | null): void {
  const trimmed = value?.trim()
  setSnippet(trimmed ? trimmed.slice(-MAX_SNIPPET_CHARS) : null)
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
