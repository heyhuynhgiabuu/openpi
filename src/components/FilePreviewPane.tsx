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
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { createEffect, createMemo, createSignal, onCleanup } from 'solid-js'
import { collectCodeSearchMatches, isValidCodeSearchQuery } from '../lib/codeSearch'
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
  const [vimMode, setVimMode] = createSignal(false)
  const [editorTheme, setEditorTheme] = createSignal<EditorThemeId>(readStoredEditorTheme())
  const [saveError, setSaveError] = createSignal<string | null>(null)

  let editorViewRef: EditorView | undefined

  createEffect(() => {
    window.localStorage.setItem(EDITOR_THEME_STORAGE_KEY, editorTheme())
  })
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

  const findMatches = createMemo(() => {
    const text = editBuffer()
    const inSelection = findInSelection()
    const from = inSelection ? findSelStart() : undefined
    const to = inSelection ? findSelEnd() : undefined

    return collectCodeSearchMatches({
      text,
      query: findQuery(),
      caseSensitive: findCaseSensitive(),
      wholeWord: findWholeWord(),
      regex: findRegex(),
      from,
      to,
    })
  })

  const findTotal = createMemo(() => findMatches().length)
  const safeMatchIndex = createMemo(() =>
    findTotal() === 0 ? 0 : ((findMatchIndex() % findTotal()) + findTotal()) % findTotal()
  )
  const findQueryIsInvalid = createMemo(
    () =>
      findQuery() !== '' &&
      !isValidCodeSearchQuery({ text: editBuffer(), query: findQuery(), regex: findRegex() })
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
    setFindSelStart(0)
    setFindSelEnd(0)
  }

  const selectMatchAt = (index: number) => {
    const matches = findMatches()
    if (!matches.length || !editorViewRef) return
    const safeIndex = ((index % matches.length) + matches.length) % matches.length
    const match = matches[safeIndex]
    if (!match) return

    editorViewRef.dispatch({
      selection: EditorSelection.range(match.index, match.index + match.length),
      effects: EditorView.scrollIntoView(match.index, { y: 'center' }),
    })
    editorViewRef.focus()
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

  // Replace current match through CodeMirror so undo/redo and selection history stay intact.
  const replaceNext = () => {
    const matches = findMatches()
    const match = matches[safeMatchIndex()]
    if (!match) return

    const replacement = replaceQuery()
    if (!editorViewRef) {
      const text = editBuffer()
      setEditBuffer(
        text.slice(0, match.index) + replacement + text.slice(match.index + match.length)
      )
      return
    }

    const cursor = match.index + replacement.length
    editorViewRef.dispatch({
      changes: { from: match.index, to: match.index + match.length, insert: replacement },
      selection: { anchor: cursor },
      scrollIntoView: true,
    })
  }

  // Replace every match in one CodeMirror transaction to preserve a single undo step.
  const replaceAll = () => {
    const matches = findMatches()
    if (!matches.length) return

    const replacement = replaceQuery()
    if (!editorViewRef) {
      let result = editBuffer()
      for (let i = matches.length - 1; i >= 0; i--) {
        const match = matches[i]
        if (match) {
          result =
            result.slice(0, match.index) + replacement + result.slice(match.index + match.length)
        }
      }
      setEditBuffer(result)
      setFindMatchIndex(0)
      return
    }

    editorViewRef.dispatch({
      changes: matches.map((match) => ({
        from: match.index,
        to: match.index + match.length,
        insert: replacement,
      })),
      selection: { anchor: matches[0]?.index ?? 0 },
      scrollIntoView: true,
    })
    setFindMatchIndex(0)
  }

  const selectAllMatches = () => {
    const matches = findMatches()
    if (!matches.length || !editorViewRef) return

    editorViewRef.dispatch({
      selection: EditorSelection.create(
        matches.map((match) => EditorSelection.range(match.index, match.index + match.length))
      ),
      scrollIntoView: true,
    })
    editorViewRef.focus()
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

  // Scroll to the active CodeMirror search match without recomputing line offsets in the DOM.
  createEffect(() => {
    const matches = findMatches()
    const idx = safeMatchIndex()
    if (matches.length === 0 || !findOpen()) return
    const match = matches[idx]
    if (!match || !editorViewRef) return

    editorViewRef.dispatch({
      effects: EditorView.scrollIntoView(match.index, { y: 'center' }),
    })
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
        <FilePreviewToolbar
          filename={filename()}
          parentName={parentName()}
          truncated={truncated()}
          isImage={isImage()}
          isDirty={isDirty()}
          saveStatus={saveStatus()}
          formatOnSave={formatOnSave()}
          editorTheme={editorTheme()}
          wordWrap={wordWrap()}
          vimMode={vimMode()}
          mode={mode()}
          saving={saving()}
          truncatedFile={truncated()}
          content={content()}
          loading={loading()}
          onFormatOnSaveToggle={() => setFormatOnSave((v) => !v)}
          onEditorThemeChange={(theme) => setEditorTheme(theme)}
          onWordWrapToggle={() => setWordWrap((v) => !v)}
          onVimModeToggle={() => setVimMode((v) => !v)}
          onSave={() => void handleSave()}
          onToggleSplit={toggleSplit}
          onToggleMode={toggleMode}
          onClose={props.onClose}
        />

        <FilePreviewFindBar
          findOpen={findOpen()}
          findQuery={findQuery()}
          findCaseSensitive={findCaseSensitive()}
          findWholeWord={findWholeWord()}
          findRegex={findRegex()}
          findReplaceOpen={findReplaceOpen()}
          replaceQuery={replaceQuery()}
          findInSelection={findInSelection()}
          findTotal={findTotal()}
          safeMatchIndex={safeMatchIndex()}
          findQueryIsInvalid={findQueryIsInvalid()}
          modeIsEdit={mode() === 'edit'}
          inputRef={findInputRef}
          replaceInputRef={replaceInputRef}
          onFindQueryChange={setFindQuery}
          onFindMatchIndexReset={() => setFindMatchIndex(0)}
          onFindCaseSensitiveToggle={() => {
            setFindCaseSensitive((v) => !v)
            setFindMatchIndex(0)
          }}
          onFindWholeWordToggle={() => {
            setFindWholeWord((v) => !v)
            setFindMatchIndex(0)
          }}
          onFindRegexToggle={() => {
            setFindRegex((v) => !v)
            setFindMatchIndex(0)
          }}
          onFindReplaceOpenToggle={setFindReplaceOpen}
          onReplaceQueryChange={setReplaceQuery}
          onFindInSelectionToggle={() => {
            setFindInSelection((v) => !v)
            setFindMatchIndex(0)
          }}
          onFindNext={findNext}
          onFindPrev={findPrev}
          onCloseFindBar={closeFindBar}
          onSelectAllMatches={selectAllMatches}
          onToggleInSelection={toggleInSelection}
          onReplaceNext={replaceNext}
          onReplaceAll={replaceAll}
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
          findOpen={findOpen()}
          findQuery={findQuery()}
          findCaseSensitive={findCaseSensitive()}
          findWholeWord={findWholeWord()}
          findRegex={findRegex()}
          safeMatchIndex={safeMatchIndex()}
          previewScrollRef={previewScrollRef}
          onEditBufferChange={setEditBuffer}
          onSetMode={setMode}
          onSyncEditorToPreview={syncEditorToPreview}
          onSyncPreviewToEditor={syncPreviewToEditor}
          onOpenFindBar={openFindBar}
          onEditorViewInit={(v) => {
            editorViewRef = v
          }}
        />
      </div>
    </section>
  )
}
