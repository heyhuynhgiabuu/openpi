/**
 * CodeMirrorEditor — thin CM6 wrapper for FilePreviewPane.
 *
 * Replaces the custom LineNumberedEditor (textarea + Shiki).
 * Keeps the same props surface so FilePreviewPane needs minimal changes.
 */

import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { rust } from '@codemirror/lang-rust'
import { Compartment, EditorState, type Extension, Prec } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { vim } from '@replit/codemirror-vim'
import { atomone } from '@uiw/codemirror-theme-atomone'
import { aura } from '@uiw/codemirror-theme-aura'
import { githubDark, githubLight } from '@uiw/codemirror-theme-github'
import { nord } from '@uiw/codemirror-theme-nord'
import { tokyoNight } from '@uiw/codemirror-theme-tokyo-night'
import { vscodeDark } from '@uiw/codemirror-theme-vscode'
import { xcodeDark, xcodeLight } from '@uiw/codemirror-theme-xcode'
import { basicSetup } from 'codemirror'
import { createEffect, createSignal, onCleanup, onMount } from 'solid-js'
import { getActiveSearchMatch, searchHighlightExtension } from './editor/search'

// ── Language detection ───────────────────────────────────────────────────────

const LANG_MAP: Record<string, (() => Extension) | undefined> = {
  js: () => javascript(),
  jsx: () => javascript({ jsx: true }),
  ts: () => javascript({ typescript: true }),
  tsx: () => javascript({ jsx: true, typescript: true }),
  mjs: () => javascript(),
  cjs: () => javascript(),
  py: () => python(),
  python: () => python(),
  rs: () => rust(),
  rust: () => rust(),
  json: () => json(),
  md: () => markdown(),
  mdx: () => markdown(),
  markdown: () => markdown(),
  css: () => css(),
  scss: () => css(),
  less: () => css(),
  html: () => html(),
  htm: () => html(),
  xml: () => html(),
  svg: () => html(),
}

function languageFor(filename: string): Extension {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  const factory = LANG_MAP[ext]
  if (factory) return factory()
  return []
}

export const EDITOR_THEMES = [
  { id: 'github', label: 'GitHub' },
  { id: 'tokyo-night', label: 'Tokyo Night' },
  { id: 'nord', label: 'Nord' },
  { id: 'atom-one', label: 'Atom One' },
  { id: 'aura', label: 'Aura' },
  { id: 'xcode', label: 'Xcode' },
  { id: 'copilot', label: 'Copilot' },
] as const

export type EditorThemeId = (typeof EDITOR_THEMES)[number]['id']

export function isEditorThemeId(value: string): value is EditorThemeId {
  return EDITOR_THEMES.some((theme) => theme.id === value)
}

function codeMirrorThemeForCurrentAppTheme(themeId: EditorThemeId = 'github'): Extension {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light'

  switch (themeId) {
    case 'github':
      return isLight ? githubLight : githubDark
    case 'tokyo-night':
      return tokyoNight
    case 'nord':
      return nord
    case 'atom-one':
      return atomone
    case 'aura':
      return aura
    case 'xcode':
      return isLight ? xcodeLight : xcodeDark
    case 'copilot':
      return vscodeDark
  }
}

// ── Theme ────────────────────────────────────────────────────────────────────

const editorChromeTheme = EditorView.theme({
  '&': {
    fontSize: '12.5px',
    fontFamily: "'Berkeley Mono', 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
    backgroundColor: 'transparent',
    height: '100%',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: "'Berkeley Mono', 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
    lineHeight: '1.6',
    backgroundColor: 'transparent',
  },
  '.cm-content': {
    backgroundColor: 'transparent',
    caretColor: 'var(--ink)',
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    borderRight: '1px solid var(--hairline)',
    color: 'var(--graphite)',
    fontSize: '11px',
    minWidth: '36px',
  },
  '.cm-gutter': { backgroundColor: 'transparent' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--surface-soft)' },
  '.cm-activeLine': { backgroundColor: 'var(--surface-soft)' },
  '.cm-cursor': { borderLeftColor: 'var(--ink)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 28%, transparent)',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--surface-soft)',
    color: 'var(--graphite)',
    border: '1px solid var(--hairline)',
    borderRadius: '2px',
    padding: '0 4px',
    fontSize: '11px',
  },
  '.cm-matchingBracket': {
    backgroundColor: 'rgba(55, 148, 255, 0.1)',
    outline: '1px solid var(--accent)',
  },
  '.cm-openpi-searchMatch': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 30%, transparent)',
    borderRadius: '2px',
  },
  '.cm-openpi-searchMatch-current': {
    backgroundColor: 'color-mix(in srgb, var(--warning) 45%, var(--accent) 20%)',
    outline: '1px solid color-mix(in srgb, var(--warning) 70%, transparent)',
  },
})

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
      effects: languageCompartment.reconfigure(languageFor(props.filename)),
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
