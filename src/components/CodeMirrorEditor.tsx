/**
 * CodeMirrorEditor — thin CM6 wrapper for FilePreviewPane.
 *
 * Replaces the custom LineNumberedEditor (textarea + Shiki).
 * Keeps the same props surface so FilePreviewPane needs minimal changes.
 */

import { Compartment, EditorState, Prec } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { vim } from '@replit/codemirror-vim'
import { basicSetup } from 'codemirror'
import { createEffect, createSignal, onCleanup, onMount } from 'solid-js'
import { diagnosticsFor } from './editor/diagnostics'
import { languageFor } from './editor/language'
import { getActiveSearchMatch, searchHighlightExtension } from './editor/search'
import {
  codeMirrorThemeForCurrentAppTheme,
  EDITOR_THEMES,
  type EditorThemeId,
  editorChromeTheme,
  isEditorThemeId,
} from './editor/theme'

export type { EditorThemeId }
export { EDITOR_THEMES, isEditorThemeId }

// ── Props ────────────────────────────────────────────────────────────────────

export interface CodeMirrorEditorProps {
  value: string
  onChange: (v: string) => void
  filename: string
  /** Callback to expose the EditorView instance for external DOM access (scroll sync, focus) */
  onViewInit?: (view: EditorView) => void
  onExtraScroll?: () => void
  onFindRequest?: () => void
  onReplaceRequest?: () => void
  wordWrap?: boolean
  vimMode?: boolean
  editorTheme?: EditorThemeId
  searchQuery?: string
  searchCaseSensitive?: boolean
  searchWholeWord?: boolean
  searchRegex?: boolean
  searchCurrentIndex?: number
}

// ── Component ────────────────────────────────────────────────────────────────

export function CodeMirrorEditor(props: CodeMirrorEditorProps) {
  let editorRef!: HTMLDivElement
  let view: EditorView | undefined
  const [ready, setReady] = createSignal(false)
  const languageCompartment = new Compartment()
  const diagnosticsCompartment = new Compartment()
  const themeCompartment = new Compartment()
  const searchHighlightCompartment = new Compartment()
  const wordWrapCompartment = new Compartment()
  const vimCompartment = new Compartment()

  onMount(() => {
    view = new EditorView({
      state: EditorState.create({
        doc: props.value,
        extensions: [
          Prec.highest(
            keymap.of([
              {
                key: 'Mod-f',
                run: () => {
                  props.onFindRequest?.()
                  return true
                },
              },
              {
                key: 'Mod-Alt-f',
                run: () => {
                  props.onReplaceRequest?.()
                  return true
                },
              },
              {
                key: 'Mod-Shift-f',
                run: () => {
                  props.onReplaceRequest?.()
                  return true
                },
              },
            ])
          ),
          vimCompartment.of(props.vimMode ? vim() : []),
          basicSetup,
          EditorState.allowMultipleSelections.of(true),
          themeCompartment.of(codeMirrorThemeForCurrentAppTheme(props.editorTheme)),
          editorChromeTheme,
          wordWrapCompartment.of(props.wordWrap ? EditorView.lineWrapping : []),
          searchHighlightCompartment.of(
            searchHighlightExtension({
              text: props.value,
              query: props.searchQuery,
              caseSensitive: props.searchCaseSensitive,
              wholeWord: props.searchWholeWord,
              regex: props.searchRegex,
              currentIndex: props.searchCurrentIndex,
            })
          ),
          languageCompartment.of(languageFor(props.filename)),
          diagnosticsCompartment.of(diagnosticsFor(props.filename)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              props.onChange(update.state.doc.toString())
            }
          }),
        ],
      }),
      parent: editorRef,
    })

    const themeObserver = new MutationObserver(() => {
      view?.dispatch({
        effects: themeCompartment.reconfigure(codeMirrorThemeForCurrentAppTheme(props.editorTheme)),
      })
    })
    themeObserver.observe(document.documentElement, {
      attributeFilter: ['data-theme'],
      attributes: true,
    })

    props.onViewInit?.(view)
    setReady(true)

    onCleanup(() => {
      themeObserver.disconnect()
      view?.destroy()
      view = undefined
    })
  })

  // Sync external value changes into editor (avoid loops — only when different)
  createEffect(() => {
    if (!view || !ready()) return
    const current = view.state.doc.toString()
    if (current !== props.value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: props.value },
      })
    }
  })

  createEffect(() => {
    if (!view || !ready()) return
    view.dispatch({
      effects: [
        languageCompartment.reconfigure(languageFor(props.filename)),
        diagnosticsCompartment.reconfigure(diagnosticsFor(props.filename)),
      ],
    })
  })

  createEffect(() => {
    if (!view || !ready()) return
    view.dispatch({
      effects: themeCompartment.reconfigure(codeMirrorThemeForCurrentAppTheme(props.editorTheme)),
    })
  })

  createEffect(() => {
    if (!view || !ready()) return
    view.dispatch({
      effects: wordWrapCompartment.reconfigure(props.wordWrap ? EditorView.lineWrapping : []),
    })
  })

  createEffect(() => {
    if (!view || !ready()) return
    view.dispatch({
      effects: vimCompartment.reconfigure(props.vimMode ? vim() : []),
    })
  })

  createEffect(() => {
    if (!view || !ready()) return
    view.dispatch({
      effects: searchHighlightCompartment.reconfigure(
        searchHighlightExtension({
          text: props.value,
          query: props.searchQuery,
          caseSensitive: props.searchCaseSensitive,
          wholeWord: props.searchWholeWord,
          regex: props.searchRegex,
          currentIndex: props.searchCurrentIndex,
        })
      ),
    })
  })

  createEffect(() => {
    if (!view || !ready()) return
    const match = getActiveSearchMatch({
      text: props.value,
      query: props.searchQuery,
      caseSensitive: props.searchCaseSensitive,
      wholeWord: props.searchWholeWord,
      regex: props.searchRegex,
      currentIndex: props.searchCurrentIndex,
    })
    if (!match) return

    view.dispatch({
      effects: EditorView.scrollIntoView(match.from, { y: 'center' }),
    })
  })

  return (
    <div
      ref={editorRef!}
      class="cm-editor-wrapper"
      style={{ height: '100%', overflow: 'hidden' }}
    />
  )
}
