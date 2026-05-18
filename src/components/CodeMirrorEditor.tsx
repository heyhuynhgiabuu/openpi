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
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { githubDark, githubLight } from '@uiw/codemirror-theme-github'
import { basicSetup, EditorView } from 'codemirror'
import { createEffect, createSignal, onCleanup, onMount } from 'solid-js'

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

function codeMirrorThemeForCurrentAppTheme(): Extension {
  return document.documentElement.getAttribute('data-theme') === 'light' ? githubLight : githubDark
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
})

// ── Props ────────────────────────────────────────────────────────────────────

export interface CodeMirrorEditorProps {
  value: string
  onChange: (v: string) => void
  filename: string
  /** Callback to expose the EditorView instance for external DOM access (scroll sync, focus) */
  onViewInit?: (view: EditorView) => void
  onExtraScroll?: () => void
}

// ── Component ────────────────────────────────────────────────────────────────

export function CodeMirrorEditor(props: CodeMirrorEditorProps) {
  let editorRef!: HTMLDivElement
  let view: EditorView | undefined
  const [ready, setReady] = createSignal(false)
  const languageCompartment = new Compartment()
  const themeCompartment = new Compartment()

  onMount(() => {
    view = new EditorView({
      state: EditorState.create({
        doc: props.value,
        extensions: [
          basicSetup,
          themeCompartment.of(codeMirrorThemeForCurrentAppTheme()),
          editorChromeTheme,
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
        effects: themeCompartment.reconfigure(codeMirrorThemeForCurrentAppTheme()),
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

  return (
    <div
      ref={editorRef!}
      class="cm-editor-wrapper"
      style={{ height: '100%', overflow: 'hidden' }}
    />
  )
}
