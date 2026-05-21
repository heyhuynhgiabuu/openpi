import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { atomone } from '@uiw/codemirror-theme-atomone'
import { aura } from '@uiw/codemirror-theme-aura'
import { githubDark, githubLight } from '@uiw/codemirror-theme-github'
import { nord } from '@uiw/codemirror-theme-nord'
import { tokyoNight } from '@uiw/codemirror-theme-tokyo-night'
import { vscodeDark } from '@uiw/codemirror-theme-vscode'
import { xcodeDark, xcodeLight } from '@uiw/codemirror-theme-xcode'

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

export function codeMirrorThemeForCurrentAppTheme(themeId: EditorThemeId = 'github'): Extension {
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

export const editorChromeTheme = EditorView.theme({
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
  '.cm-diagnostic-error': {
    borderBottom: '1px dotted var(--danger)',
  },
  '.cm-trailingSpace': {
    backgroundColor: 'rgba(255, 85, 85, 0.15)',
  },
})
