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

import type { EditorView } from '@codemirror/view'
import { createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { useFilePreviewFind } from '../hooks/useFilePreviewFind'
import type { NewFileLineComment } from '../lib/fileLineComments'
import { ensureHighlighter, highlightCode } from '../lib/shiki'
import { type EditorThemeId, isEditorThemeId } from './CodeMirrorEditor'
import type { ViewMode } from './FilePreviewBody'
import { FilePreviewBody } from './FilePreviewBody'
import { FilePreviewFindBar } from './FilePreviewFindBar'
import { FilePreviewToolbar } from './FilePreviewToolbar'

const EDITOR_THEME_STORAGE_KEY = 'openpi:file-preview-editor-theme'

function readStoredEditorTheme(): EditorThemeId {
  const stored = window.localStorage.getItem(EDITOR_THEME_STORAGE_KEY)
  return stored && isEditorThemeId(stored) ? stored : 'github'
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Strip Shiki's inline background-color so the editor background shows through */
function _stripShikiBackground(html: string): string {
  return html.replace(/background-color:[^;"'}]+;?\s*/g, '').replace(/\stabindex="0"/g, '')
}

export function SyntaxPreview(props: { name: string; contents: string }) {
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
  const wordWrap = () => true
  const [vimMode, setVimMode] = createSignal(false)
  const [editorTheme, setEditorTheme] = createSignal<EditorThemeId>(readStoredEditorTheme())
  const [saveError, setSaveError] = createSignal<string | null>(null)

  createEffect(() => {
    window.localStorage.setItem(EDITOR_THEME_STORAGE_KEY, editorTheme())
  })
  const editorEl = (): HTMLElement | undefined => editorViewRef?.dom ?? undefined
  let paneRef: HTMLElement | undefined
  let previewScrollRef: HTMLDivElement | undefined
  let saveStatusTimer: ReturnType<typeof setTimeout> | undefined
  let isSyncingScroll = false

  let editorViewRef: EditorView | undefined

  const find = useFilePreviewFind({
    getEditBuffer: editBuffer,
    setEditBuffer,
    editorViewRef: () => editorViewRef,
    getMode: mode,
    findOpen: () => props.findOpen ?? false,
    onFindOpened: props.onFindOpened,
  })

  onMount(() => {
    const handleFindShortcut = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'f' || !(event.metaKey || event.ctrlKey)) return
      const target = event.target
      const activeElement = document.activeElement
      const eventStartedInPane = target instanceof Node && paneRef?.contains(target)
      const focusInsidePane = activeElement instanceof Node && paneRef?.contains(activeElement)
      if (eventStartedInPane || focusInsidePane) {
        event.preventDefault()
        event.stopPropagation()
        find.openFindBar()
      }
    }

    document.addEventListener('keydown', handleFindShortcut, true)
    onCleanup(() => document.removeEventListener('keydown', handleFindShortcut, true))
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
        if (find.findOpen()) {
          find.closeFindBar()
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
        find.openFindBar(true) // Cmd+Shift+F → find with replace (like VS Code/Zed)
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        if (e.altKey) {
          find.openFindBar(true) // Cmd+Alt+F → open with replace
        } else {
          find.openFindBar()
        }
      }
      if (find.findOpen() && e.altKey) {
        if (e.key.toLowerCase() === 'c') {
          e.preventDefault()
          find.setFindCaseSensitive((v) => !v)
          find.setFindMatchIndex(0)
        }
        if (e.key.toLowerCase() === 'w') {
          e.preventDefault()
          find.setFindWholeWord((v) => !v)
          find.setFindMatchIndex(0)
        }
        if (e.key.toLowerCase() === 'r') {
          e.preventDefault()
          find.setFindRegex((v) => !v)
          find.setFindMatchIndex(0)
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
    <section
      ref={(el) => {
        paneRef = el
      }}
      class="file-preview-pane"
      aria-label={`File preview: ${filename()}`}
    >
      <div class="fv-modal fv-modal--embedded">
        <FilePreviewToolbar
          truncated={truncated()}
          isImage={isImage()}
          isMarkdown={isMarkdown()}
          isDirty={isDirty()}
          saveStatus={saveStatus()}
          formatOnSave={formatOnSave()}
          editorTheme={editorTheme()}
          vimMode={vimMode()}
          mode={mode()}
          saving={saving()}
          truncatedFile={truncated()}
          content={content()}
          loading={loading()}
          onFormatOnSaveToggle={() => setFormatOnSave((v) => !v)}
          onEditorThemeChange={(theme) => setEditorTheme(theme)}
          onVimModeToggle={() => setVimMode((v) => !v)}
          onOpenFind={() => find.openFindBar(false)}
          onSave={() => void handleSave()}
          onToggleSplit={toggleSplit}
          onToggleMode={toggleMode}
          onClose={props.onClose}
        />

        <FilePreviewFindBar
          findOpen={find.findOpen()}
          findQuery={find.findQuery()}
          findCaseSensitive={find.findCaseSensitive()}
          findWholeWord={find.findWholeWord()}
          findRegex={find.findRegex()}
          findReplaceOpen={find.findReplaceOpen()}
          replaceQuery={find.replaceQuery()}
          findInSelection={find.findInSelection()}
          findTotal={find.findTotal()}
          safeMatchIndex={find.safeMatchIndex()}
          findQueryIsInvalid={find.findQueryIsInvalid()}
          modeIsEdit={mode() === 'edit'}
          onInputRef={find.setFindInputRef}
          onReplaceInputRef={find.setReplaceInputRef}
          onFindQueryChange={find.setFindQuery}
          onFindMatchIndexReset={() => find.setFindMatchIndex(0)}
          onFindCaseSensitiveToggle={() => {
            find.setFindCaseSensitive((v) => !v)
            find.setFindMatchIndex(0)
          }}
          onFindWholeWordToggle={() => {
            find.setFindWholeWord((v) => !v)
            find.setFindMatchIndex(0)
          }}
          onFindRegexToggle={() => {
            find.setFindRegex((v) => !v)
            find.setFindMatchIndex(0)
          }}
          onFindReplaceOpenToggle={find.setFindReplaceOpen}
          onReplaceQueryChange={find.setReplaceQuery}
          onFindInSelectionToggle={() => {
            find.setFindInSelection((v) => !v)
            find.setFindMatchIndex(0)
          }}
          onFindNext={find.findNext}
          onFindPrev={find.findPrev}
          onCloseFindBar={find.closeFindBar}
          onSelectAllMatches={find.selectAllMatches}
          onToggleInSelection={find.toggleInSelection}
          onReplaceNext={find.replaceNext}
          onReplaceAll={find.replaceAll}
        />
        <FilePreviewBody
          saveError={saveError()}
          isImage={isImage()}
          imgSrc={imgSrc()}
          filename={filename()}
          loading={loading()}
          content={content()}
          mode={mode()}
          editBuffer={editBuffer()}
          isMarkdown={isMarkdown()}
          wordWrap={wordWrap()}
          vimMode={vimMode()}
          editorTheme={editorTheme()}
          findOpen={find.findOpen()}
          findQuery={find.findQuery()}
          findCaseSensitive={find.findCaseSensitive()}
          findWholeWord={find.findWholeWord()}
          findRegex={find.findRegex()}
          safeMatchIndex={find.safeMatchIndex()}
          previewScrollRef={previewScrollRef}
          onEditBufferChange={setEditBuffer}
          onSetMode={setMode}
          onSyncEditorToPreview={syncEditorToPreview}
          onSyncPreviewToEditor={syncPreviewToEditor}
          onOpenFindBar={find.openFindBar}
          onEditorViewInit={(v) => {
            editorViewRef = v
          }}
        />
      </div>
    </section>
  )
}
