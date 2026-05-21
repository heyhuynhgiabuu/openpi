import { type Extension, RangeSetBuilder } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view'
import { collectCodeSearchMatches } from '../../lib/codeSearch'

export interface SearchOptions {
  text: string
  query?: string
  caseSensitive?: boolean
  wholeWord?: boolean
  regex?: boolean
  currentIndex?: number
}

function collectSearchMatches(options: SearchOptions): Array<{ from: number; to: number }> {
  return collectCodeSearchMatches(options).map((match) => ({
    from: match.index,
    to: match.index + match.length,
  }))
}

function activeSearchIndex(matchesLength: number, currentIndex = 0): number {
  return ((currentIndex % matchesLength) + matchesLength) % matchesLength
}

export function getActiveSearchMatch(
  options: SearchOptions
): { from: number; to: number } | undefined {
  try {
    const matches = collectSearchMatches(options)
    if (!matches.length) return undefined
    return matches[activeSearchIndex(matches.length, options.currentIndex)]
  } catch {
    return undefined
  }
}

function buildSearchDecorations(options: SearchOptions): DecorationSet {
  try {
    const matches = collectSearchMatches(options)
    if (!matches.length) return Decoration.none

    const currentIndex = activeSearchIndex(matches.length, options.currentIndex)
    const builder = new RangeSetBuilder<Decoration>()

    matches.forEach((match, index) => {
      builder.add(
        match.from,
        match.to,
        Decoration.mark({
          class:
            index === currentIndex
              ? 'cm-openpi-searchMatch cm-openpi-searchMatch-current'
              : 'cm-openpi-searchMatch',
        })
      )
    })

    return builder.finish()
  } catch {
    return Decoration.none
  }
}

export function searchHighlightExtension(options: SearchOptions): Extension {
  return EditorView.decorations.of(buildSearchDecorations(options))
}
