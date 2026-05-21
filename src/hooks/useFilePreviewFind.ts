import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { createEffect, createMemo, createSignal, type Setter } from 'solid-js'
import { collectCodeSearchMatches, isValidCodeSearchQuery } from '../lib/codeSearch'

export interface UseFilePreviewFindOptions {
  getEditBuffer: () => string
  setEditBuffer?: (v: string) => void
  editorViewRef: () => EditorView | undefined
  getMode: () => string
  findOpen?: boolean
  onFindOpened?: () => void
}

export interface UseFilePreviewFindReturn {
  findOpen: () => boolean
  setFindOpen: Setter<boolean>
  findQuery: () => string
  setFindQuery: Setter<string>
  findMatchIndex: () => number
  setFindMatchIndex: Setter<number>
  findCaseSensitive: () => boolean
  setFindCaseSensitive: Setter<boolean>
  findWholeWord: () => boolean
  setFindWholeWord: Setter<boolean>
  findRegex: () => boolean
  setFindRegex: Setter<boolean>
  findReplaceOpen: () => boolean
  setFindReplaceOpen: Setter<boolean>
  replaceQuery: () => string
  setReplaceQuery: Setter<string>
  findInSelection: () => boolean
  setFindInSelection: Setter<boolean>
  findMatches: () => Array<{ index: number; length: number }>
  findTotal: () => number
  safeMatchIndex: () => number
  findQueryIsInvalid: () => boolean
  findInputRef: HTMLInputElement | undefined
  replaceInputRef: HTMLInputElement | undefined
  openFindBar: (withReplace?: boolean) => void
  closeFindBar: () => void
  findNext: () => void
  findPrev: () => void
  replaceNext: () => void
  replaceAll: () => void
  selectAllMatches: () => void
  toggleInSelection: () => void
}

export function useFilePreviewFind(options: UseFilePreviewFindOptions): UseFilePreviewFindReturn {
  const { getEditBuffer, setEditBuffer, editorViewRef } = options

  const [findOpen, setFindOpen] = createSignal(false)
  const [findQuery, setFindQuery] = createSignal('')
  const [findMatchIndex, setFindMatchIndex] = createSignal(0)
  const [findCaseSensitive, setFindCaseSensitive] = createSignal(false)
  const [findWholeWord, setFindWholeWord] = createSignal(false)
  const [findRegex, setFindRegex] = createSignal(false)
  const [findReplaceOpen, setFindReplaceOpen] = createSignal(false)
  const [replaceQuery, setReplaceQuery] = createSignal('')
  const [findInSelection, setFindInSelection] = createSignal(false)

  let findInputRef: HTMLInputElement | undefined
  let replaceInputRef: HTMLInputElement | undefined

  const findMatches = createMemo(() => {
    const text = getEditBuffer()
    return collectCodeSearchMatches({
      text,
      query: findQuery(),
      caseSensitive: findCaseSensitive(),
      wholeWord: findWholeWord(),
      regex: findRegex(),
    })
  })

  const findTotal = createMemo(() => findMatches().length)

  const safeMatchIndex = createMemo(() =>
    findTotal() === 0 ? 0 : ((findMatchIndex() % findTotal()) + findTotal()) % findTotal()
  )

  const findQueryIsInvalid = createMemo(
    () =>
      findQuery() !== '' &&
      !isValidCodeSearchQuery({ text: getEditBuffer(), query: findQuery(), regex: findRegex() })
  )

  const openFindBar = (withReplace = false) => {
    setFindOpen(true)
    if (withReplace) {
      setFindReplaceOpen(true)
      setTimeout(() => replaceInputRef?.focus(), 30)
    } else {
      setTimeout(() => findInputRef?.focus(), 30)
    }
  }

  const closeFindBar = () => {
    setFindOpen(false)
    setFindQuery('')
    setFindMatchIndex(0)
    setFindReplaceOpen(false)
    setReplaceQuery('')
    setFindInSelection(false)
  }

  const selectMatchAt = (index: number) => {
    const matches = findMatches()
    if (!matches.length) return
    const view = editorViewRef()
    if (!view) return
    const safeIndex = ((index % matches.length) + matches.length) % matches.length
    const match = matches[safeIndex]
    if (!match) return
    view.dispatch({
      selection: EditorSelection.range(match.index, match.index + match.length),
      effects: EditorView.scrollIntoView(match.index, { y: 'center' }),
    })
    view.focus()
  }

  const findNext = () => {
    const next = safeMatchIndex() + 1
    setFindMatchIndex(next)
    selectMatchAt(next)
  }

  const findPrev = () => {
    const next = safeMatchIndex() - 1
    setFindMatchIndex(next)
    selectMatchAt(next)
  }

  const replaceNext = () => {
    const matches = findMatches()
    const match = matches[safeMatchIndex()]
    if (!match) return
    const replacement = replaceQuery()
    const view = editorViewRef()

    if (view) {
      const cursor = match.index + replacement.length
      view.dispatch({
        changes: { from: match.index, to: match.index + match.length, insert: replacement },
        selection: { anchor: cursor },
        scrollIntoView: true,
      })
    } else if (setEditBuffer) {
      const text = getEditBuffer()
      setEditBuffer(
        text.slice(0, match.index) + replacement + text.slice(match.index + match.length)
      )
    }
  }

  const replaceAll = () => {
    const matches = findMatches()
    if (!matches.length) return
    const replacement = replaceQuery()
    const view = editorViewRef()

    if (view) {
      view.dispatch({
        changes: matches.map((match) => ({
          from: match.index,
          to: match.index + match.length,
          insert: replacement,
        })),
        selection: { anchor: matches[0]?.index ?? 0 },
        scrollIntoView: true,
      })
    } else if (setEditBuffer) {
      let result = getEditBuffer()
      for (let i = matches.length - 1; i >= 0; i--) {
        const m = matches[i]
        if (m) result = result.slice(0, m.index) + replacement + result.slice(m.index + m.length)
      }
      setEditBuffer(result)
    }
    setFindMatchIndex(0)
  }

  const selectAllMatches = () => {
    const matches = findMatches()
    if (!matches.length) return
    const view = editorViewRef()
    if (!view) return
    view.dispatch({
      selection: EditorSelection.create(
        matches.map((match) => EditorSelection.range(match.index, match.index + match.length))
      ),
      scrollIntoView: true,
    })
    view.focus()
  }

  const toggleInSelection = () => {
    if (findInSelection()) {
      setFindInSelection(false)
      setFindMatchIndex(0)
      return
    }
    setFindInSelection(false)
    setFindMatchIndex(0)
  }

  createEffect(() => {
    const matches = findMatches()
    const idx = safeMatchIndex()
    if (matches.length === 0 || !findOpen()) return
    const match = matches[idx]
    const view = editorViewRef()
    if (!match || !view) return
    view.dispatch({
      effects: EditorView.scrollIntoView(match.index, { y: 'center' }),
    })
  })

  createEffect(() => {
    if (options.findOpen) {
      openFindBar()
      options.onFindOpened?.()
    }
  })

  return {
    findOpen,
    setFindOpen,
    findQuery,
    setFindQuery,
    findMatchIndex,
    setFindMatchIndex,
    findCaseSensitive,
    setFindCaseSensitive,
    findWholeWord,
    setFindWholeWord,
    findRegex,
    setFindRegex,
    findReplaceOpen,
    setFindReplaceOpen,
    replaceQuery,
    setReplaceQuery,
    findInSelection,
    setFindInSelection,
    findMatches,
    findTotal,
    safeMatchIndex,
    findQueryIsInvalid,
    findInputRef,
    replaceInputRef,
    openFindBar,
    closeFindBar,
    findNext,
    findPrev,
    replaceNext,
    replaceAll,
    selectAllMatches,
    toggleInSelection,
  }
}
