/**
 * FileViewerModal — file content overlay with Agents-app-style top bar.
 *
 * Top bar (left → right):
 *   [file-icon]  [filename]  /  [parent-name]   |  [split-side] [preview] [maximize] [─] [×]
 *
 * Modes:
 *   - edit     → line-numbered editable textarea with per-line modified/added indicators
 *   - preview  → rendered markdown (for .md files) or shiki syntax highlight
 *   - maximize → fullscreen below macOS traffic lights (top: 28px)
 *
 * Authority: file read via window.openpi.readFile() — Electron main validates path.
 * Images rendered via localfile:// — no readFile call.
 */

// biome-ignore-all lint/a11y/useSemanticElements lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: existing file-viewer line/overlay interactions are tracked separately from this release.
import { Code2, FileText, Maximize2, Minimize2, PanelRight, Plus, Save, X } from 'lucide-solid'
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js'
import { FileIcon } from '../lib/fileIcons'
import type { NewFileLineComment } from '../lib/fileLineComments'
import { formatLineRange } from '../lib/fileLineComments'
import { ensureHighlighter, highlightCode } from '../lib/shiki'
import { MarkdownContent } from './conversation/MarkdownContent'

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
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

const LINE_HEIGHT_PX = 20
const PADDING_TOP_PX = 14

interface HeadingEntry {
  lineIndex: number
  level: number
  raw: string
}

function parseHeadings(lines: string[]): HeadingEntry[] {
  const out: HeadingEntry[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i]?.match(/^(#{1,6})\s/)
    if (m) out.push({ lineIndex: i, level: m[1].length, raw: lines[i] })
  }
  return out
}

function getStickyHeadings(headings: HeadingEntry[], scrollTop: number, maxN = 3): HeadingEntry[] {
  const levelMap = new Map<number, HeadingEntry>()
  for (const heading of headings) {
    const lineBottom = PADDING_TOP_PX + heading.lineIndex * LINE_HEIGHT_PX + LINE_HEIGHT_PX
    if (lineBottom > scrollTop) break
    levelMap.set(heading.level, heading)
    for (const lvl of levelMap.keys()) {
      if (lvl > heading.level) levelMap.delete(lvl)
    }
  }
  return [...levelMap.values()].sort((a, b) => a.level - b.level).slice(0, maxN)
}

function computeFoldRanges(headings: HeadingEntry[], totalLines: number): Map<number, number> {
  const ranges = new Map<number, number>()
  for (let i = 0; i < headings.length; i += 1) {
    const heading = headings[i]
    let end = totalLines - 1
    for (let j = i + 1; j < headings.length; j += 1) {
      if (headings[j].level <= heading.level) {
        end = headings[j].lineIndex - 1
        break
      }
    }
    if (end > heading.lineIndex) ranges.set(heading.lineIndex, end)
  }
  return ranges
}

interface LineRange {
  startLine: number
  endLine: number
}

function lineNumberForOffset(value: string, offset: number): number {
  return value.slice(0, Math.max(0, offset)).split('\n').length
}

function selectedLineRange(
  value: string,
  selectionStart: number,
  selectionEnd: number
): LineRange | null {
  if (selectionStart === selectionEnd) return null
  const start = Math.min(selectionStart, selectionEnd)
  const end = Math.max(selectionStart, selectionEnd)
  const adjustedEnd = Math.max(start, end - 1)
  return {
    startLine: lineNumberForOffset(value, start),
    endLine: lineNumberForOffset(value, adjustedEnd),
  }
}

function snippetForRange(lines: string[], range: LineRange): string {
  return lines.slice(range.startLine - 1, range.endLine).join('\n')
}

type DisplayItem =
  | { type: 'line'; sourceIdx: number }
  | { type: 'fold'; headingIdx: number; count: number }

interface LineEditorProps {
  value: string
  originalContent: string | null
  relativePath: string
  onChange: (v: string) => void
  setTextareaRef: (el: HTMLTextAreaElement) => void
  onAddLineComment?: (comment: NewFileLineComment) => void
  onExtraScroll?: () => void
}

function LineNumberedEditor(props: LineEditorProps) {
  let gutterRef!: HTMLDivElement
  let textareaRef!: HTMLTextAreaElement
  let commentInputRef: HTMLTextAreaElement | undefined
  const [scrollTop, setScrollTop] = createSignal(0)
  const [hoverLine, setHoverLine] = createSignal<number | null>(null)
  const [selectedRange, setSelectedRange] = createSignal<LineRange | null>(null)
  const [commentRange, setCommentRange] = createSignal<LineRange | null>(null)
  const [commentText, setCommentText] = createSignal('')

  const lines = createMemo(() => props.value.split('\n'))
  const headings = createMemo(() => parseHeadings(lines()))
  const stickyHeadings = createMemo(() => getStickyHeadings(headings(), scrollTop()))

  const headingLineMap = createMemo(() => {
    const m = new Map<number, number>()
    for (const heading of headings()) m.set(heading.lineIndex, heading.level)
    return m
  })

  const [collapsedSections, setCollapsedSections] = createSignal<Set<number>>(new Set())

  const foldRanges = createMemo(() => computeFoldRanges(headings(), lines().length))

  const toggleFold = (headingLineIdx: number) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev)
      if (next.has(headingLineIdx)) next.delete(headingLineIdx)
      else next.add(headingLineIdx)
      return next
    })
  }

  const displayItems = createMemo<DisplayItem[]>(() => {
    const items: DisplayItem[] = []
    let i = 0
    while (i < lines().length) {
      const foldEnd = foldRanges().get(i)
      if (collapsedSections().has(i) && foldEnd !== undefined) {
        items.push({ type: 'line', sourceIdx: i })
        items.push({ type: 'fold', headingIdx: i, count: foldEnd - i })
        i = foldEnd + 1
      } else {
        items.push({ type: 'line', sourceIdx: i })
        i += 1
      }
    }
    return items
  })

  const hasCollapsed = createMemo(() => collapsedSections().size > 0)

  const displayValue = createMemo(() => {
    if (!hasCollapsed()) return props.value
    return displayItems()
      .map((item) => (item.type === 'fold' ? `··· ${item.count} lines` : lines()[item.sourceIdx]))
      .join('\n')
  })

  const handleContentClick = (e: MouseEvent) => {
    if (!hasCollapsed() || !textareaRef) return
    const rect = textareaRef.getBoundingClientRect()
    const y = e.clientY - rect.top + textareaRef.scrollTop - PADDING_TOP_PX
    const clickedRow = Math.floor(y / LINE_HEIGHT_PX)
    if (clickedRow >= 0 && clickedRow < displayItems().length) {
      const item = displayItems()[clickedRow]
      if (item.type === 'fold') toggleFold(item.headingIdx)
    }
  }

  const handleScroll = () => {
    if (gutterRef && textareaRef) gutterRef.scrollTop = textareaRef.scrollTop
    if (textareaRef) setScrollTop(textareaRef.scrollTop)
    props.onExtraScroll?.()
  }

  const scrollToLine = (lineIndex: number) => {
    if (!textareaRef) return
    textareaRef.scrollTop = Math.max(0, lineIndex * LINE_HEIGHT_PX)
  }

  const rangeTop = (range: LineRange) =>
    PADDING_TOP_PX + (range.startLine - 1) * LINE_HEIGHT_PX - scrollTop()

  const hoverRange = createMemo<LineRange | null>(() => {
    const line = hoverLine()
    if (line === null) return null
    return { startLine: line, endLine: line }
  })

  const actionableRange = createMemo(() => commentRange() ?? selectedRange() ?? hoverRange())
  const commentButtonRange = createMemo(() => {
    if (!props.onAddLineComment || hasCollapsed()) return null
    return actionableRange()
  })

  const updateSelectionRange = () => {
    if (!textareaRef || hasCollapsed()) return
    setSelectedRange(
      selectedLineRange(props.value, textareaRef.selectionStart, textareaRef.selectionEnd)
    )
  }

  const updateHoverLine = (event: MouseEvent) => {
    if (!textareaRef || hasCollapsed() || commentRange()) return
    const rect = textareaRef.getBoundingClientRect()
    const y = event.clientY - rect.top + textareaRef.scrollTop - PADDING_TOP_PX
    const row = Math.floor(y / LINE_HEIGHT_PX)
    if (row < 0 || row >= lines().length) {
      setHoverLine(null)
      return
    }
    setHoverLine(row + 1)
  }

  const isLineInActiveRange = (line: number) => {
    const range = actionableRange()
    return Boolean(range && line >= range.startLine && line <= range.endLine)
  }

  const activeRangeStyle = (range: LineRange) => ({
    top: `${rangeTop(range)}px`,
    height: `${(range.endLine - range.startLine + 1) * LINE_HEIGHT_PX}px`,
  })

  const openCommentPopover = (range: LineRange) => {
    setCommentRange(range)
    setCommentText('')
    requestAnimationFrame(() => commentInputRef?.focus())
  }

  const saveComment = () => {
    const range = commentRange()
    const comment = commentText().trim()
    if (!range || !comment) return

    props.onAddLineComment?.({
      path: props.relativePath,
      startLine: range.startLine,
      endLine: range.endLine,
      comment,
      snippet: snippetForRange(lines(), range),
    })
    setCommentRange(null)
    setSelectedRange(null)
    setHoverLine(null)
    setCommentText('')
    textareaRef?.focus()
  }

  const origLines = createMemo(() =>
    props.originalContent !== null ? props.originalContent.split('\n') : null
  )

  return (
    <div class="fv-le-wrap">
      <Show when={stickyHeadings().length > 0}>
        <div class="fv-le-sticky" role="navigation" aria-label="Sticky context">
          <For each={stickyHeadings()}>
            {(heading) => (
              <div
                class="fv-le-sticky-line"
                data-level={heading.level}
                onClick={() => scrollToLine(heading.lineIndex)}
                title={`Jump to line ${heading.lineIndex + 1}`}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') scrollToLine(heading.lineIndex)
                }}
              >
                <span class="fv-le-sticky-ln">{heading.lineIndex + 1}</span>
                <span class="fv-le-sticky-text">{heading.raw}</span>
              </div>
            )}
          </For>
        </div>
      </Show>

      <div class="fv-le-row">
        <div
          ref={(el) => {
            gutterRef = el
          }}
          class="fv-le-gutter"
          aria-hidden="true"
        >
          <div class="fv-le-gutter-inner">
            <For each={displayItems()}>
              {(item) => {
                if (item.type === 'fold') {
                  return (
                    <div
                      class="fv-le-ln fv-le-fold-placeholder-ln"
                      role="button"
                      tabIndex={0}
                      title={`Expand ${item.count} lines`}
                      onClick={() => toggleFold(item.headingIdx)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') toggleFold(item.headingIdx)
                      }}
                    >
                      <span class="fv-le-fold-dots">···</span>
                    </div>
                  )
                }

                const i = item.sourceIdx
                const originalLine = origLines()?.[i]
                const isModified =
                  origLines() !== null &&
                  i < (origLines()?.length ?? 0) &&
                  lines()[i] !== originalLine
                const isAdded = origLines() !== null && i >= (origLines()?.length ?? 0)
                const headingLevel = headingLineMap().get(i)
                const isFoldable = foldRanges().has(i)
                const isCollapsed = collapsedSections().has(i)

                return (
                  <div
                    class={[
                      'fv-le-ln',
                      isModified ? 'is-modified' : '',
                      isAdded ? 'is-added' : '',
                      headingLevel ? `is-h${headingLevel}` : '',
                      isFoldable ? 'is-foldable' : '',
                      isLineInActiveRange(i + 1) ? 'is-comment-target' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <Show when={isFoldable}>
                      <button
                        type="button"
                        class={`fv-le-fold-btn${isCollapsed ? ' is-collapsed' : ''}`}
                        title={isCollapsed ? 'Expand section' : 'Collapse section'}
                        tabIndex={-1}
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleFold(i)
                        }}
                        aria-label={isCollapsed ? 'Expand' : 'Collapse'}
                      >
                        {isCollapsed ? '▶' : '▼'}
                      </button>
                    </Show>
                    {i + 1}
                  </div>
                )
              }}
            </For>
          </div>
        </div>

        <div class="fv-le-content-wrap" onClick={(e) => handleContentClick(e)}>
          <Show when={commentButtonRange()}>
            {(getRange) => (
              <div class="fv-line-comment-highlight" style={activeRangeStyle(getRange())} />
            )}
          </Show>

          <Show when={commentButtonRange()}>
            {(getRange) => (
              <button
                type="button"
                class="fv-line-comment-btn"
                style={{ top: `${rangeTop(getRange())}px` }}
                title={`Add comment on ${formatLineRange(getRange().startLine, getRange().endLine)}`}
                aria-label={`Add comment on ${formatLineRange(getRange().startLine, getRange().endLine)}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  openCommentPopover(getRange())
                }}
              >
                <Plus size={13} strokeWidth={2.4} />
              </button>
            )}
          </Show>

          <Show when={commentRange()}>
            {(getRange) => (
              <div
                class="fv-line-comment-popover"
                style={{ top: `${rangeTop(getRange()) + LINE_HEIGHT_PX + 8}px` }}
              >
                <textarea
                  ref={(el) => {
                    commentInputRef = el
                  }}
                  class="fv-line-comment-input"
                  placeholder="Add comment"
                  rows={3}
                  value={commentText()}
                  onInput={(event) => setCommentText(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                      event.preventDefault()
                      saveComment()
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      setCommentRange(null)
                    }
                  }}
                />
                <div class="fv-line-comment-footer">
                  <span>{`Commenting on ${formatLineRange(getRange().startLine, getRange().endLine)}`}</span>
                  <div class="fv-line-comment-actions">
                    <button
                      type="button"
                      class="fv-line-comment-secondary"
                      onClick={() => setCommentRange(null)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      class="fv-line-comment-primary"
                      disabled={commentText().trim().length === 0}
                      onClick={saveComment}
                    >
                      Comment
                    </button>
                  </div>
                </div>
              </div>
            )}
          </Show>

          <textarea
            ref={(el) => {
              textareaRef = el
              props.setTextareaRef(el)
            }}
            class={`fv-le-textarea${hasCollapsed() ? ' fv-le-textarea--folded' : ''}`}
            value={hasCollapsed() ? displayValue() : props.value}
            onInput={hasCollapsed() ? undefined : (e) => props.onChange(e.currentTarget.value)}
            readOnly={hasCollapsed()}
            onMouseMove={updateHoverLine}
            onMouseLeave={() => setHoverLine(null)}
            onMouseUp={() => requestAnimationFrame(updateSelectionRange)}
            onKeyUp={updateSelectionRange}
            onSelect={updateSelectionRange}
            onScroll={handleScroll}
            spellcheck={false}
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
          />
        </div>
      </div>
    </div>
  )
}

type ViewMode = 'edit' | 'preview' | 'split'

interface FileViewerModalProps {
  relativePath: string
  cwd: string
  workspaceName: string
  background?: boolean
  onAddLineComment?: (comment: NewFileLineComment) => void
  onClose: () => void
}

export function FileViewerModal(props: FileViewerModalProps) {
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
  const [maximized, setMaximized] = createSignal(false)
  const [saving, setSaving] = createSignal(false)
  const [saveStatus, setSaveStatus] = createSignal<'idle' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = createSignal<string | null>(null)

  let textareaRef: HTMLTextAreaElement | undefined
  let previewScrollRef: HTMLDivElement | undefined
  let saveStatusTimer: ReturnType<typeof setTimeout> | undefined
  let isSyncingScroll = false

  const isDirty = createMemo(() => content() !== null && editBuffer() !== content())

  const syncEditorToPreview = () => {
    if (!textareaRef || !previewScrollRef || isSyncingScroll) return
    const maxA = textareaRef.scrollHeight - textareaRef.clientHeight
    if (maxA <= 0) return
    const pct = textareaRef.scrollTop / maxA
    isSyncingScroll = true
    previewScrollRef.scrollTop =
      pct * (previewScrollRef.scrollHeight - previewScrollRef.clientHeight)
    requestAnimationFrame(() => {
      isSyncingScroll = false
    })
  }

  const syncPreviewToEditor = () => {
    if (!textareaRef || !previewScrollRef || isSyncingScroll) return
    const maxB = previewScrollRef.scrollHeight - previewScrollRef.clientHeight
    if (maxB <= 0) return
    const pct = previewScrollRef.scrollTop / maxB
    isSyncingScroll = true
    textareaRef.scrollTop = pct * (textareaRef.scrollHeight - textareaRef.clientHeight)
    requestAnimationFrame(() => {
      isSyncingScroll = false
    })
  }

  createEffect(() => {
    const relPath = props.relativePath
    if (isImage()) return

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
    if (!props.background && mode() === 'edit' && !loading() && textareaRef) {
      setTimeout(() => textareaRef?.focus(), 30)
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

  createEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!props.background && e.key === 'Escape') props.onClose()
      if (!props.background && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void handleSave()
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

  const toggleMaximize = () => {
    setMaximized((prev) => !prev)
  }

  return (
    <div
      class={`fv-overlay${maximized() ? ' fv-overlay--maximized' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={`File: ${filename()}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose()
      }}
    >
      <div class={`fv-modal${maximized() ? ' fv-modal--maximized' : ''}`}>
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

            <button
              type="button"
              class={`fv-tb-btn${maximized() ? ' fv-tb-btn--active' : ''}`}
              title={maximized() ? 'Restore' : 'Maximize editor'}
              onClick={toggleMaximize}
            >
              <Show when={maximized()} fallback={<Maximize2 size={14} strokeWidth={1.8} />}>
                <Minimize2 size={14} strokeWidth={1.8} />
              </Show>
            </button>

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
            <LineNumberedEditor
              value={editBuffer()}
              originalContent={content()}
              relativePath={normalizedPath()}
              onChange={setEditBuffer}
              setTextareaRef={(el) => {
                textareaRef = el
              }}
              onAddLineComment={props.onAddLineComment}
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
                <LineNumberedEditor
                  value={editBuffer()}
                  originalContent={content()}
                  relativePath={normalizedPath()}
                  onChange={setEditBuffer}
                  setTextareaRef={(el) => {
                    textareaRef = el
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
    </div>
  )
}
