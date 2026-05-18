/**
 * FilePreviewPane — file content center pane with Agents-app-style top bar.
 *
 * Top bar (left → right):
 *   [file-icon]  [filename]  /  [parent-name]   |  [split-side] [preview] [maximize] [─] [×]
 *
 * Modes:
 *   - edit     → line-numbered editable textarea with per-line modified/added indicators
 *   - preview  → rendered markdown (for .md files) or shiki syntax highlight
 * Authority: file read via window.openpi.readFile() — Electron main validates path.
 * Images rendered via localfile:// — no readFile call.
 */

// biome-ignore-all lint/a11y/useSemanticElements lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: existing file-preview line interactions are tracked separately from this release.
import type { EditorView } from '@codemirror/view'

import {
  ChevronDown,
  ChevronUp,
  Code2,
  FileText,
  PanelBottomOpen,
  PanelRight,
  Replace,
  ReplaceAll,
  Save,
  Search,
  X,
} from 'lucide-solid'
import { createEffect, createMemo, createSignal, onCleanup, Show } from 'solid-js'
import { FileIcon } from '../lib/fileIcons'
import type { NewFileLineComment } from '../lib/fileLineComments'
import { ensureHighlighter, highlightCode } from '../lib/shiki'
import { CodeMirrorEditor } from './CodeMirrorEditor'
import { MarkdownContent } from './conversation/MarkdownContent'

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Strip Shiki's inline background-color so the editor background shows through */
function _stripShikiBackground(html: string): string {
  return html.replace(/background-color:[^;"'}]+;?\s*/g, '').replace(/\stabindex="0"/g, '')
}

function SyntaxPreview(props: { name: string; contents: string }) {
  const [html, setHtml] = createSignal('')

  createEffect(() => {
    const name = props.name
    const contents = props.contents
    let cancelled = false

    setHtml(`<pre>${escapeHtml(contents)}</pre>`)

    void ensureHighlighter()
      .then(() => {
        if (!cancelled) setHtml(highlightCode(contents, name))
      })
      .catch(() => {
        if (!cancelled) setHtml(`<pre>${escapeHtml(contents)}</pre>`)
      })

    onCleanup(() => {
      cancelled = true
    })
  })

  return <div class="fv-code-preview" innerHTML={html()} />
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'svg', 'avif'])
const MD_EXTS = new Set(['md', 'mdx', 'markdown'])

function isImageFile(name: string): boolean {
  return IMAGE_EXTS.has(name.split('.').pop()?.toLowerCase() ?? '')
}

function isMarkdownFile(name: string): boolean {
  return MD_EXTS.has(name.split('.').pop()?.toLowerCase() ?? '')
}

function localFileUrl(absPath: string): string {
  return `localfile://${absPath
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/')}`
}

/* LINE_HEIGHT_PX and PADDING_TOP_PX removed with LineNumberedEditor */

type ViewMode = 'edit' | 'preview' | 'split'

interface FilePreviewPaneProps {
  relativePath: string
  cwd: string
  workspaceName: string
  /** True while another overlay (e.g. file search) is active; suppresses focus/hotkeys. */
  background?: boolean
  /** When true, the find bar is opened immediately (e.g. from Cmd+F keybinding). */
  findOpen?: boolean
  /** Called after the find bar is opened so the parent can reset its trigger signal. */
  onFindOpened?: () => void
  onAddLineComment?: (comment: NewFileLineComment) => void
  onClose: () => void
}

export function FilePreviewPane(props: FilePreviewPaneProps) {
  const normalizedPath = createMemo(() => props.relativePath.replace(/\\/g, '/'))
  const pathParts = createMemo(() => normalizedPath().split('/'))
  const filename = createMemo(() => pathParts()[pathParts().length - 1] ?? props.relativePath)
  const parentName = createMemo(() =>
    pathParts().length >= 2
      ? pathParts()[pathParts().length - 2] || props.workspaceName
      : props.workspaceName
  )

  const isImage = createMemo(() => isImageFile(filename()))
  const isMarkdown = createMemo(() => isMarkdownFile(filename()))
  const absPath = createMemo(() =>
    props.relativePath.startsWith('/') ? props.relativePath : `${props.cwd}/${props.relativePath}`
  )
  const imgSrc = createMemo(() => localFileUrl(absPath()))

  const [content, setContent] = createSignal<string | null>(null)
  const [editBuffer, setEditBuffer] = createSignal('')
  const [loading, setLoading] = createSignal(!isImage())
  const [truncated, setTruncated] = createSignal(false)
  const [mode, setMode] = createSignal<ViewMode>('edit')
  const [saving, setSaving] = createSignal(false)
  const [saveStatus, setSaveStatus] = createSignal<'idle' | 'saved' | 'error'>('idle')

  const [formatOnSave, setFormatOnSave] = createSignal(false)
  const [wordWrap, setWordWrap] = createSignal(false)
  const [saveError, setSaveError] = createSignal<string | null>(null)

  let editorViewRef: EditorView | undefined
  const editorEl = (): HTMLElement | undefined => editorViewRef?.dom ?? undefined
  let previewScrollRef: HTMLDivElement | undefined
  let saveStatusTimer: ReturnType<typeof setTimeout> | undefined
  let isSyncingScroll = false
  let findInputRef: HTMLInputElement | undefined
  let replaceInputRef: HTMLInputElement | undefined

  // ── Find bar ─────────────────────────────────────────────────────────────
  const [findOpen, setFindOpen] = createSignal(false)
  const [findQuery, setFindQuery] = createSignal('')
  const [findMatchIndex, setFindMatchIndex] = createSignal(0)
  const [findCaseSensitive, setFindCaseSensitive] = createSignal(false)
  const [findWholeWord, setFindWholeWord] = createSignal(false)
  const [findRegex, setFindRegex] = createSignal(false)
  // Replace
  const [findReplaceOpen, setFindReplaceOpen] = createSignal(false)
  const [replaceQuery, setReplaceQuery] = createSignal('')
  // In-selection search
  const [findInSelection, setFindInSelection] = createSignal(false)
  const [findSelStart, setFindSelStart] = createSignal(0)
  const [findSelEnd, setFindSelEnd] = createSignal(0)

  const findMatches = createMemo((): Array<{ index: number; length: number }> => {
    const q = findQuery()
    const text = editBuffer()
    if (!q || !text) return []
    const inSel = findInSelection()
    const selStart = findSelStart()
    const selEnd = findSelEnd()
    try {
      let pattern: string
      if (findRegex()) {
        pattern = q
      } else {
        pattern = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        if (findWholeWord()) pattern = `\\b${pattern}\\b`
      }
      const flags = findCaseSensitive() ? 'g' : 'gi'
      const re = new RegExp(pattern, flags)
      const matches: Array<{ index: number; length: number }> = []
      for (let m = re.exec(text); m !== null; m = re.exec(text)) {
        if (!inSel || (m.index >= selStart && m.index + m[0].length <= selEnd)) {
          matches.push({ index: m.index, length: m[0].length })
        }
        if (m[0].length === 0) re.lastIndex++
      }
      return matches
    } catch {
      return []
    }
  })

  const findTotal = createMemo(() => findMatches().length)
  const safeMatchIndex = createMemo(() =>
    findTotal() === 0 ? 0 : ((findMatchIndex() % findTotal()) + findTotal()) % findTotal()
  )

  // 0-indexed line numbers containing any match — drives minimap indicators
  const _findMatchLines = createMemo(() => {
    const matches = findMatches()
    const text = editBuffer()
    if (!matches.length || !text) return []
    const lineSet = new Set<number>()
    for (const m of matches) {
      lineSet.add(text.substring(0, m.index).split('\n').length - 1)
    }
    return Array.from(lineSet)
  })

  // Line of the currently-active match
  const _currentMatchLine = createMemo(() => {
    const matches = findMatches()
    const text = editBuffer()
    const m = matches[safeMatchIndex()]
    if (!m || !text) return -1
    return text.substring(0, m.index).split('\n').length - 1
  })

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
    setFindSelStart(0)
    setFindSelEnd(0)
  }

  const findNext = () => setFindMatchIndex((i) => i + 1)
  const findPrev = () => setFindMatchIndex((i) => i - 1)

  // Replace current match and advance
  const replaceNext = () => {
    const matches = findMatches()
    const idx = safeMatchIndex()
    const m = matches[idx]
    if (!m) return
    const text = editBuffer()
    setEditBuffer(text.slice(0, m.index) + replaceQuery() + text.slice(m.index + m.length))
    // matches recompute reactively; safeMatchIndex auto-clamps
  }

  // Replace every match at once (end-to-start to preserve earlier indices)
  const replaceAll = () => {
    const matches = findMatches()
    if (!matches.length) return
    const replacement = replaceQuery()
    let result = editBuffer()
    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i]
      if (m) result = result.slice(0, m.index) + replacement + result.slice(m.index + m.length)
    }
    setEditBuffer(result)
    setFindMatchIndex(0)
  }

  // Select all match spans in the textarea (first→last range; best we can do without multi-cursor)
  const selectAllMatches = () => {
    const _matches = findMatches()
    // CM6 handles search internally — textarea find disabled
  }

  // Capture current textarea selection as the search scope
  const toggleInSelection = () => {
    if (findInSelection()) {
      setFindInSelection(false)
      setFindMatchIndex(0)
      return
    }
    if (!editorEl()) return
    const start = 0
    const end = 0 // cm6
    if (start === end) return // nothing selected — no-op
    setFindSelStart(start)
    setFindSelEnd(end)
    setFindInSelection(true)
    setFindMatchIndex(0)
  }

  // Scroll to current match in textarea
  createEffect(() => {
    const matches = findMatches()
    const idx = safeMatchIndex()
    if (matches.length === 0 || !findOpen()) return
    const m = matches[idx]
    if (!m) return
    const lines = editBuffer().substring(0, m.index).split('\n')
    const lineNumber = lines.length - 1
    const lineHeight =
      (editorEl()?.scrollHeight ?? 0) / Math.max(editBuffer().split('\n').length, 1)
    const el = editorEl()
    if (el) el.scrollTop = Math.max(0, lineNumber * lineHeight - (el.clientHeight ?? 0) / 2)
  })

  // Open find bar when findOpen prop changes to true
  createEffect(() => {
    if (props.findOpen) {
      openFindBar()
      props.onFindOpened?.()
    }
  })

  const isDirty = createMemo(() => content() !== null && editBuffer() !== content())

  // Reset to edit mode (with live syntax highlighting) when switching to a different file
  createEffect(() => {
    void props.relativePath // track path changes
    if (!isImage()) setMode('edit')
  })

  const syncEditorToPreview = () => {
    const el = editorViewRef?.dom
    if (!el || !previewScrollRef || isSyncingScroll) return
    const maxA = el.scrollHeight - el.clientHeight
    if (maxA <= 0) return
    const pct = el.scrollTop / maxA
    isSyncingScroll = true
    previewScrollRef.scrollTop =
      pct * (previewScrollRef.scrollHeight - previewScrollRef.clientHeight)
    requestAnimationFrame(() => {
      isSyncingScroll = false
    })
  }

  const syncPreviewToEditor = () => {
    const el = editorViewRef?.dom
    if (!el || !previewScrollRef || isSyncingScroll) return
    const maxB = previewScrollRef.scrollHeight - previewScrollRef.clientHeight
    if (maxB <= 0) return
    const pct = previewScrollRef.scrollTop / maxB
    isSyncingScroll = true
    el.scrollTop = pct * (el.scrollHeight - el.clientHeight)
    requestAnimationFrame(() => {
      isSyncingScroll = false
    })
  }

  createEffect(() => {
    const relPath = props.relativePath
    if (!relPath || isImage()) return // guard: never call readFile with empty path

    let cancelled = false
    setLoading(true)

    void window.openpi.readFile(relPath).then((result) => {
      if (cancelled) return
      if (result) {
        setContent(result.content)
        setEditBuffer(result.content)
        setTruncated(result.truncated)
      } else {
        setContent(null)
        setEditBuffer('')
      }
      setLoading(false)
    })

    onCleanup(() => {
      cancelled = true
    })
  })

  createEffect(() => {
    if (!props.background && mode() === 'edit' && !loading() && editorEl()) {
      setTimeout(() => editorEl()?.focus(), 30)
    }
  })

  const handleSave = async () => {
    if (isImage() || truncated() || content() === null || !isDirty() || saving()) return
    setSaving(true)
    setSaveStatus('idle')
    setSaveError(null)
    try {
      await window.openpi.writeFile(normalizedPath(), editBuffer())
      setContent(editBuffer())

      // Auto-format after save if format-on-save is enabled
      if (formatOnSave()) {
        try {
          const formatted = await window.openpi.formatFile(normalizedPath())
          setEditBuffer(formatted)
          setContent(formatted)
        } catch {
          // format failure is non-fatal — file was already saved
        }
      }

      setSaveStatus('saved')
      if (saveStatusTimer) clearTimeout(saveStatusTimer)
      saveStatusTimer = setTimeout(() => setSaveStatus('idle'), 1400)
    } catch (err) {
      setSaveStatus('error')
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  /** Run Biome format on the current file (does not save). */
  const _handleFormat = async () => {
    if (isImage() || content() === null) return

    try {
      const formatted = await window.openpi.formatFile(normalizedPath())
      setEditBuffer(formatted)
      setContent(formatted)
    } catch (err) {
      setSaveStatus('error')
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
    }
  }

  createEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (props.background) return
      if (e.key === 'Escape') {
        if (findOpen()) {
          closeFindBar()
          return
        }
        props.onClose()
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void handleSave()
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        openFindBar(true) // Cmd+Shift+F → find with replace (like VS Code/Zed)
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        if (e.altKey) {
          openFindBar(true) // Cmd+Alt+F → open with replace
        } else {
          openFindBar()
        }
      }
      if (findOpen() && e.altKey) {
        if (e.key.toLowerCase() === 'c') {
          e.preventDefault()
          setFindCaseSensitive((v) => !v)
          setFindMatchIndex(0)
        }
        if (e.key.toLowerCase() === 'w') {
          e.preventDefault()
          setFindWholeWord((v) => !v)
          setFindMatchIndex(0)
        }
        if (e.key.toLowerCase() === 'r') {
          e.preventDefault()
          setFindRegex((v) => !v)
          setFindMatchIndex(0)
        }
      }
    }
    window.addEventListener('keydown', handler)
    onCleanup(() => window.removeEventListener('keydown', handler))
  })

  onCleanup(() => {
    if (saveStatusTimer) clearTimeout(saveStatusTimer)
  })

  const toggleMode = () => {
    setMode((prev) => {
      if (prev === 'split') return 'preview'
      return prev === 'edit' ? 'preview' : 'edit'
    })
  }

  const toggleSplit = () => {
    setMode((prev) => (prev === 'split' ? 'edit' : 'split'))
  }

  return (
    <section class="file-preview-pane" aria-label={`File preview: ${filename()}`}>
      <div class="fv-modal fv-modal--embedded">
        <div class="fv-topbar">
          <div class="fv-topbar-identity">
            <FileIcon name={filename()} size={14} />
            <span class="fv-topbar-filename">{filename()}</span>
            <span class="fv-topbar-sep">/</span>
            <span class="fv-topbar-parent">{parentName()}</span>
            <Show when={truncated()}>
              <span class="fv-topbar-badge">truncated</span>
            </Show>
            <Show when={!isImage() && isDirty()}>
              <span class="fv-topbar-badge fv-topbar-badge--dirty">unsaved</span>
            </Show>
            <Show when={saveStatus() === 'saved'}>
              <span class="fv-topbar-badge fv-topbar-badge--saved">saved</span>
            </Show>
            <Show when={saveStatus() === 'error'}>
              <span class="fv-topbar-badge fv-topbar-badge--error">save failed</span>
            </Show>
          </div>

          <div class="fv-topbar-actions">
            <Show when={!isImage()}>
              <button
                type="button"
                class={`fv-tb-btn${formatOnSave() ? ' fv-tb-btn--active' : ''}`}
                title={
                  formatOnSave()
                    ? 'Format on save enabled (⌘⇧F to format now)'
                    : 'Format on save disabled'
                }
                onClick={() => setFormatOnSave((v) => !v)}
              >
                <Code2 size={14} strokeWidth={1.8} />
              </button>
            </Show>

            <Show when={!isImage()}>
              <button
                type="button"
                class={`fv-tb-btn${wordWrap() ? ' fv-tb-btn--active' : ''}`}
                title={wordWrap() ? 'Disable word wrap' : 'Enable word wrap'}
                onClick={() => setWordWrap((v) => !v)}
              >
                <FileText size={14} strokeWidth={1.8} />
              </button>
            </Show>

            <Show when={!isImage()}>
              <span class="fv-tb-divider" />
            </Show>

            <Show when={!isImage()}>
              <button
                type="button"
                class={`fv-tb-btn${isDirty() ? ' fv-tb-btn--dirty' : ''}`}
                title={truncated() ? 'Cannot save truncated file' : 'Save (⌘S)'}
                onClick={() => void handleSave()}
                disabled={!isDirty() || saving() || truncated()}
              >
                <Save size={14} strokeWidth={1.8} />
              </button>
            </Show>

            <Show when={!isImage()}>
              <button
                type="button"
                class={`fv-tb-btn${mode() === 'split' ? ' fv-tb-btn--active' : ''}`}
                title={mode() === 'split' ? 'Close side preview' : 'Open preview to the side'}
                onClick={toggleSplit}
                disabled={!isImage() && content() === null && !loading()}
              >
                <PanelRight size={14} strokeWidth={1.8} />
              </button>
            </Show>

            <Show when={!isImage() && mode() !== 'split'}>
              <button
                type="button"
                class={`fv-tb-btn${mode() === 'preview' ? ' fv-tb-btn--active' : ''}`}
                title={mode() === 'preview' ? 'Reopen as editable text' : 'Open preview'}
                onClick={toggleMode}
              >
                <Show
                  when={mode() === 'preview'}
                  fallback={<FileText size={14} strokeWidth={1.8} />}
                >
                  <Code2 size={14} strokeWidth={1.8} />
                </Show>
              </button>
            </Show>

            <span class="fv-tb-divider" />

            <button
              type="button"
              class="fv-tb-btn fv-tb-btn--close"
              title="Close (Esc)"
              onClick={props.onClose}
            >
              <X size={14} strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* ── Find / Replace bar (Cmd+F / Cmd+⌥F) ──────────────────── */}
        <Show when={findOpen()}>
          {/* ── Search row ── */}
          <div class="fv-find-bar">
            {/* Replace-toggle chevron (left of search icon, like Zed) */}
            <button
              type="button"
              class={`fv-find-replace-toggle${findReplaceOpen() ? ' is-active' : ''}`}
              title={`${findReplaceOpen() ? 'Hide' : 'Show'} Replace (Cmd+⌥F)`}
              onClick={() => {
                const next = !findReplaceOpen()
                setFindReplaceOpen(next)
                if (next) setTimeout(() => replaceInputRef?.focus(), 30)
              }}
            >
              <PanelBottomOpen size={13} strokeWidth={2} />
            </button>

            <Search size={12} class="fv-find-icon" />
            <input
              ref={findInputRef}
              class={`fv-find-input${
                findRegex() &&
                (() => {
                  try {
                    new RegExp(findQuery())
                    return false
                  } catch {
                    return true
                  }
                })()
                  ? ' fv-find-input--error'
                  : ''
              }`}
              type="text"
              value={findQuery()}
              placeholder={findRegex() ? 'Search regex…' : 'Find in file…'}
              onInput={(e) => {
                setFindQuery(e.currentTarget.value)
                setFindMatchIndex(0)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.shiftKey ? findPrev() : findNext()
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  closeFindBar()
                }
              }}
            />

            {/* ── Match-mode toggles (Aa / Wd / .*) ── */}
            <div class="fv-find-toggles">
              <button
                type="button"
                class={`fv-find-toggle${findCaseSensitive() ? ' is-active' : ''}`}
                title="Match case (Alt+C)"
                onClick={() => {
                  setFindCaseSensitive((v) => !v)
                  setFindMatchIndex(0)
                }}
              >
                Aa
              </button>
              <button
                type="button"
                class={`fv-find-toggle${findWholeWord() ? ' is-active' : ''}`}
                title="Match whole word (Alt+W)"
                onClick={() => {
                  setFindWholeWord((v) => !v)
                  setFindMatchIndex(0)
                }}
              >
                Wd
              </button>
              <button
                type="button"
                class={`fv-find-toggle${findRegex() ? ' is-active' : ''}`}
                title="Use regular expression (Alt+R)"
                onClick={() => {
                  setFindRegex((v) => !v)
                  setFindMatchIndex(0)
                }}
              >
                .*
              </button>
            </div>

            <span class="fv-find-sep" />

            {/* ── Selection scope + select-all ── */}
            <div class="fv-find-toggles">
              <button
                type="button"
                class={`fv-find-toggle${findInSelection() ? ' is-active' : ''}`}
                title={
                  findInSelection()
                    ? 'Clear selection scope (Alt+L)'
                    : 'Find in current selection (Alt+L) — select text first'
                }
                onClick={toggleInSelection}
              >
                [sel]
              </button>
              <button
                type="button"
                class="fv-find-toggle"
                title="Select all matches (Alt+↩)"
                onClick={selectAllMatches}
                disabled={findTotal() === 0}
              >
                all
              </button>
            </div>

            <span class="fv-find-sep" />

            {/* ── Count + navigation ── */}
            <span class="fv-find-count">
              <Show when={findQuery()}>
                {findTotal() === 0 ? 'No results' : `${safeMatchIndex() + 1} / ${findTotal()}`}
              </Show>
            </span>
            <button
              type="button"
              class="fv-find-nav"
              title="Previous (Shift+↩)"
              onClick={findPrev}
              disabled={findTotal() === 0}
            >
              <ChevronUp size={13} strokeWidth={2.2} />
            </button>
            <button
              type="button"
              class="fv-find-nav"
              title="Next (↩)"
              onClick={findNext}
              disabled={findTotal() === 0}
            >
              <ChevronDown size={13} strokeWidth={2.2} />
            </button>

            <button type="button" class="fv-find-close" title="Close (Esc)" onClick={closeFindBar}>
              <X size={12} />
            </button>
          </div>

          {/* ── Replace row (shown when findReplaceOpen) ── */}
          <Show when={findReplaceOpen()}>
            <div class="fv-find-replace-row">
              {/* Indent to align replace input under search input */}
              <span class="fv-find-replace-indent" />
              <Search size={12} class="fv-find-icon fv-find-icon--replace" />
              <input
                ref={replaceInputRef}
                class="fv-find-input"
                type="text"
                value={replaceQuery()}
                placeholder="Replace with…"
                disabled={mode() !== 'edit'}
                onInput={(e) => setReplaceQuery(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    replaceAll()
                  } else if (e.key === 'Enter') {
                    e.preventDefault()
                    replaceNext()
                  }
                  if (e.key === 'Escape') {
                    e.stopPropagation()
                    closeFindBar()
                  }
                }}
              />
              <div class="fv-find-replace-actions">
                <button
                  type="button"
                  class="fv-find-replace-btn"
                  title="Replace next (↩)"
                  onClick={replaceNext}
                  disabled={findTotal() === 0 || mode() !== 'edit'}
                >
                  <Replace size={13} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  class="fv-find-replace-btn"
                  title="Replace all (Cmd+↩)"
                  onClick={replaceAll}
                  disabled={findTotal() === 0 || mode() !== 'edit'}
                >
                  <ReplaceAll size={13} strokeWidth={2} />
                </button>
              </div>
              <Show when={mode() !== 'edit'}>
                <span class="fv-find-replace-note">switch to Edit mode to replace</span>
              </Show>
            </div>
          </Show>
        </Show>

        <div class="fv-body">
          <Show when={saveError()}>
            <div class="fv-state-msg fv-state-msg--error">{saveError()}</div>
          </Show>

          <Show when={isImage()}>
            <div class="fv-image-body">
              <img src={imgSrc()} alt={filename()} class="fv-image" />
            </div>
          </Show>

          <Show when={!isImage() && loading()}>
            <div class="fv-state-msg">Loading…</div>
          </Show>

          <Show when={!isImage() && !loading() && content() === null}>
            <div class="fv-state-msg fv-state-msg--error">
              Could not read file — it may be binary or outside the workspace.
            </div>
          </Show>

          <Show when={!isImage() && !loading() && content() !== null && mode() === 'edit'}>
            <CodeMirrorEditor
              value={editBuffer()}
              filename={filename()}
              onChange={setEditBuffer}
              onViewInit={(v) => {
                editorViewRef = v
              }}
              onExtraScroll={syncEditorToPreview}
            />
          </Show>

          <Show when={!isImage() && !loading() && content() !== null && mode() === 'preview'}>
            <Show
              when={isMarkdown()}
              fallback={<SyntaxPreview name={filename()} contents={editBuffer()} />}
            >
              <div class="fv-md-preview">
                <MarkdownContent text={editBuffer()} />
              </div>
            </Show>
          </Show>

          <Show when={!isImage() && !loading() && content() !== null && mode() === 'split'}>
            <div class="fv-split-wrap">
              <div class="fv-split-editor">
                <CodeMirrorEditor
                  value={editBuffer()}
                  filename={filename()}
                  onChange={setEditBuffer}
                  onViewInit={(v) => {
                    editorViewRef = v
                  }}
                  onExtraScroll={syncEditorToPreview}
                />
              </div>

              <div class="fv-split-divider" />

              <div class="fv-split-preview">
                <div class="fv-split-preview-header">
                  <FileIcon name={filename()} size={13} />
                  <span class="fv-split-preview-title">Preview {filename()}</span>
                  <button
                    type="button"
                    class="fv-tb-btn"
                    title="Close preview"
                    onClick={() => setMode('edit')}
                  >
                    <X size={12} strokeWidth={2} />
                  </button>
                </div>

                <div
                  ref={(el) => {
                    previewScrollRef = el
                  }}
                  class="fv-split-preview-content"
                  onScroll={syncPreviewToEditor}
                >
                  <Show
                    when={isMarkdown()}
                    fallback={<SyntaxPreview name={filename()} contents={editBuffer()} />}
                  >
                    <div class="fv-md-preview">
                      <MarkdownContent text={editBuffer()} />
                    </div>
                  </Show>
                </div>
              </div>
            </div>
          </Show>
        </div>
      </div>
    </section>
  )
}
