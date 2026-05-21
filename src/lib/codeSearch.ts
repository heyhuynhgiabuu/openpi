import { SearchQuery } from '@codemirror/search'
import { Text } from '@codemirror/state'

export interface CodeSearchMatch {
  index: number
  length: number
}

export interface CodeSearchOptions {
  text: string
  query?: string
  caseSensitive?: boolean
  wholeWord?: boolean
  regex?: boolean
  from?: number
  to?: number
}

function createCodeMirrorText(text: string): Text {
  return Text.of(text.split('\n'))
}

function createSearchQuery(options: CodeSearchOptions): SearchQuery | null {
  const query = options.query ?? ''
  if (!query || !options.text) return null

  try {
    const searchQuery = new SearchQuery({
      search: query,
      caseSensitive: options.caseSensitive,
      wholeWord: options.wholeWord,
      regexp: options.regex,
    })
    return searchQuery.valid ? searchQuery : null
  } catch {
    return null
  }
}

export function isValidCodeSearchQuery(options: CodeSearchOptions): boolean {
  return createSearchQuery(options) !== null
}

export function collectCodeSearchMatches(options: CodeSearchOptions): CodeSearchMatch[] {
  const searchQuery = createSearchQuery(options)
  if (!searchQuery) return []

  const text = createCodeMirrorText(options.text)
  const from = options.from ?? 0
  const to = options.to ?? text.length
  const matches: CodeSearchMatch[] = []

  const cursor = searchQuery.getCursor(text, from, to)
  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    const match = next.value
    if (match.to > match.from) {
      matches.push({ index: match.from, length: match.to - match.from })
    }
  }

  return matches
}
