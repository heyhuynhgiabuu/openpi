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
import {
  ChevronDown,
  ChevronUp,
  Code2,
  FileText,
  PanelBottomOpen,
  PanelRight,
  Plus,
  Replace,
  ReplaceAll,
  Save,
  Search,
  X,
} from 'lucide-solid'
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js'
import { FileIcon } from '../lib/fileIcons'
import type { NewFileLineComment } from '../lib/fileLineComments'
import { formatLineRange } from '../lib/fileLineComments'
import { ensureHighlighter, highlightCode } from '../lib/shiki'
import { MarkdownContent } from './conversation/MarkdownContent'

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Strip Shiki's inline background-color so the editor background shows through */
function stripShikiBackground(html: string): string {
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
  /** Search highlight props — when provided, match positions are highlighted */
  findQuery?: string
  findMatches?: Array<{ index: number; length: number }>
  findCurrentIndex?: number
  findMatchLines?: number[] // 0-indexed line numbers containing any match
  currentMatchLine?: number // 0-indexed line of the active match
}

// ─── Minimap ─────────────────────────────────────────────────────────────────

interface MiniMapProps {
  value: string
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  onScrollTo: (top: number) => void
  findMatchLines?: number[] // draw amber stripes on matching lines
  currentMatchLine?: number // draw bright-orange stripe on active match line
}

const MINI_W = 80
const MINI_LINE = 2 // px per line on canvas

function MiniMap(props: MiniMapProps) {
  let canvasRef: HTMLCanvasElement | undefined
  let containerRef: HTMLDivElement | undefined
  let dragging = false

  /** Re-draw canvas whenever content changes */
  createEffect(() => {
    const canvas = canvasRef
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const lines = props.value.split('\n')
    const totalLines = lines.length
    const cH = totalLines * MINI_LINE
    canvas.width = MINI_W
    canvas.height = Math.max(cH, 1)

    ctx.clearRect(0, 0, MINI_W, cH)
    for (let i = 0; i < totalLines; i++) {
      const line = lines[i]
      if (!line?.trim()) continue
      const y = i * MINI_LINE
      const indent = line.search(/\S|$/)
      const x = Math.min(indent * 1.2, 12)
      const rawLen = line.trimEnd().length - indent
      const w = Math.min((rawLen / 100) * (MINI_W - x - 2), MINI_W - x - 2)
      if (w <= 0) continue

      const trimmed = line.trimStart()
      if (trimmed.startsWith('# ')) ctx.fillStyle = 'rgba(96,165,250,0.9)'
      else if (trimmed.startsWith('## ')) ctx.fillStyle = 'rgba(96,165,250,0.7)'
      else if (trimmed.startsWith('### ') || trimmed.startsWith('#### '))
        ctx.fillStyle = 'rgba(167,139,250,0.7)'
      else if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*'))
        ctx.fillStyle = 'rgba(160,160,160,0.35)'
      else ctx.fillStyle = 'rgba(200,200,200,0.5)'

      ctx.fillRect(x, y + 0.5, Math.max(w, 1), MINI_LINE - 0.5)
    }

    // ─── Search match indicators (right-edge 4px stripes) ───────────────────
    if (props.findMatchLines?.length) {
      for (const lineIdx of props.findMatchLines) {
        const y = lineIdx * MINI_LINE
        const isCurrent = lineIdx === props.currentMatchLine
        ctx.fillStyle = isCurrent
          ? 'rgba(255, 148, 30, 0.95)' // bright orange — active match
          : 'rgba(255, 210, 60, 0.55)' // amber — other matches
        ctx.fillRect(MINI_W - 4, y, 4, MINI_LINE)
      }
    }
  })

  const totalLines = createMemo(() => props.value.split('\n').length)

  /** Viewport indicator: maps scroll position into the minimap canvas coordinate space */
  const viewport = createMemo(() => {
    const cH = totalLines() * MINI_LINE
    const sh = props.scrollHeight
    if (sh <= 0 || cH <= 0) return null
    const ratio = cH / sh
    return {
      top: props.scrollTop * ratio,
      height: Math.max(props.clientHeight * ratio, 20),
    }
  })

  const scrollToY = (clientY: number) => {
    const el = containerRef
    if (!el) return
    const rect = el.getBoundingClientRect()
    const relY = clientY - rect.top + el.scrollTop
    const cH = totalLines() * MINI_LINE
    const fraction = Math.max(0, Math.min(1, relY / cH))
    props.onScrollTo(fraction * props.scrollHeight)
  }

  /** Keep minimap scrolled so viewport indicator is always in view */
  createEffect(() => {
    const v = viewport()
    const el = containerRef
    if (!v || !el) return
    const mid = v.top + v.height / 2
    const elH = el.clientHeight
    el.scrollTop = Math.max(0, mid - elH / 2)
  })

  return (
    <div
      ref={(el) => {
        containerRef = el
      }}
      class="fv-minimap"
      onMouseDown={(e) => {
        e.preventDefault()
        dragging = true
        scrollToY(e.clientY)
      }}
      onMouseMove={(e) => {
        if (dragging) scrollToY(e.clientY)
      }}
      onMouseUp={() => {
        dragging = false
      }}
    >
      <canvas
        ref={(el) => {
          canvasRef = el
        }}
        class="fv-minimap-canvas"
      />
      <Show when={viewport()}>
        {(vp) => (
          <div
            class="fv-minimap-viewport"
            style={{ top: `${vp().top}px`, height: `${vp().height}px` }}
          />
        )}
      </Show>
    </div>
  )
}

function LineNumberedEditor(props: LineEditorProps) {
  let gutterRef!: HTMLDivElement
  let textareaRef!: HTMLTextAreaElement
  let commentInputRef: HTMLTextAreaElement | undefined
  const [scrollTop, setScrollTop] = createSignal(0)
  const [scrollHeight, setScrollHeight] = createSignal(0)
  const [clientHeight, setClientHeight] = createSignal(0)
  const [syntaxHtml, setSyntaxHtml] = createSignal('')
  const [syntaxReady, setSyntaxReady] = createSignal(false)
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

  // Syntax highlighting is active when Shiki has rendered and no folds are open
  const showSyntax = createMemo(() => syntaxReady() && !hasCollapsed())

  // Search highlight overlay HTML — builds marked-up text matching the textarea exactly.
  // color:transparent on the <pre> text, <mark> backgrounds show through.
  const searchOverlayHtml = createMemo(() => {
    const matches = props.findMatches
    if (!matches || matches.length === 0) return ''
    const text = hasCollapsed() ? displayValue() : props.value
    const currentIdx = props.findCurrentIndex ?? 0
    let html = ''
    let pos = 0
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i]
      if (!m || m.index < pos) continue
      html += escapeHtml(text.slice(pos, m.index))
      const isCurrent = i === currentIdx
      html += `<mark class="fv-search-mark${isCurrent ? ' fv-search-mark--current' : ''}">${escapeHtml(text.slice(m.index, m.index + m.length))}</mark>`
      pos = m.index + m.length
    }
    html += escapeHtml(text.slice(pos))
    return html
  })

  // Syntax highlighting — mirrors SyntaxPreview's known-good pattern.
  // Sets plain escaped HTML immediately so the overlay + transparent textarea
  // activate on mount; Shiki swaps in real token colours once loaded.
  createEffect(() => {
    const value = props.value
    const filename = props.relativePath
    let cancelled = false

    setSyntaxHtml(`<pre>${escapeHtml(value)}</pre>`)
    setSyntaxReady(true)

    void ensureHighlighter()
      .then(() => {
        if (!cancelled) setSyntaxHtml(stripShikiBackground(highlightCode(value, filename)))
      })
      .catch(() => {}) // plain fallback stays visible on error

    onCleanup(() => {
      cancelled = true
    })
  })

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
    if (textareaRef) {
      setScrollTop(textareaRef.scrollTop)
      setScrollHeight(textareaRef.scrollHeight)
      setClientHeight(textareaRef.clientHeight)
    }
    props.onExtraScroll?.()
  }

  const scrollToLine = (lineIndex: number) => {
    if (!textareaRef) return
    textareaRef.scrollTop = Math.max(0, lineIndex * LINE_HEIGHT_PX)
  }

  const scrollToTop = (top: number) => {
    if (!textareaRef) return
    textareaRef.scrollTop = top
    handleScroll()
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
          {/* Syntax highlight overlay — Shiki tokens behind transparent textarea */}
          <Show when={showSyntax()}>
            <div class="fv-le-highlight">
              <div
                class="fv-le-highlight-inner"
                style={{ transform: `translateY(-${scrollTop()}px)` }}
                innerHTML={syntaxHtml()}
              />
            </div>
          </Show>

          {/* Search match overlay — above syntax, pointer-events:none, marks float over text */}
          <Show when={searchOverlayHtml()}>
            <div class="fv-le-search-overlay">
              <pre
                class="fv-le-search-pre"
                style={{ transform: `translateY(-${scrollTop()}px)` }}
                innerHTML={searchOverlayHtml()}
              />
            </div>
          </Show>
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
              // initialise minimap dimensions once mounted
              requestAnimationFrame(() => {
                if (!el) return
                setScrollHeight(el.scrollHeight)
                setClientHeight(el.clientHeight)
              })
            }}
            class={`fv-le-textarea${hasCollapsed() ? ' fv-le-textarea--folded' : ''}`}
            style={showSyntax() ? { color: 'transparent' } : undefined}
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

        {/* Minimap — right edge quick-scroll */}
        <MiniMap
          value={props.value}
          scrollTop={scrollTop()}
          scrollHeight={scrollHeight()}
          clientHeight={clientHeight()}
          onScrollTo={scrollToTop}
          findMatchLines={props.findMatchLines}
          currentMatchLine={props.currentMatchLine}
        />
      </div>
    </div>
  )
}

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
  const [formatLoading, setFormatLoading] = createSignal(false)
  const [formatOnSave, setFormatOnSave] = createSignal(false)
  const [wordWrap, setWordWrap] = createSignal(false)
  const [saveError, setSaveError] = createSignal<string | null>(null)

  let textareaRef: HTMLTextAreaElement | undefined
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
  const findMatchLines = createMemo(() => {
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
  const currentMatchLine = createMemo(() => {
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
    const matches = findMatches()
    if (!textareaRef || !matches.length) return
    const first = matches[0]
    const last = matches[matches.length - 1]
    if (first && last) {
      textareaRef.focus()
      textareaRef.setSelectionRange(first.index, last.index + last.length)
    }
  }

  // Capture current textarea selection as the search scope
  const toggleInSelection = () => {
    if (findInSelection()) {
      setFindInSelection(false)
      setFindMatchIndex(0)
      return
    }
    if (!textareaRef) return
    const { selectionStart: start, selectionEnd: end } = textareaRef
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
    if (!textareaRef || matches.length === 0 || !findOpen()) return
    const m = matches[idx]
    if (!m) return
    const lines = editBuffer().substring(0, m.index).split('\n')
    const lineNumber = lines.length - 1
    const lineHeight = textareaRef.scrollHeight / Math.max(editBuffer().split('\n').length, 1)
    textareaRef.scrollTop = Math.max(0, lineNumber * lineHeight - textareaRef.clientHeight / 2)
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
  const handleFormat = async () => {
    if (isImage() || content() === null) return
    setFormatLoading(true)
    try {
      const formatted = await window.openpi.formatFile(normalizedPath())
      setEditBuffer(formatted)
      setContent(formatted)
    } catch (err) {
      setSaveStatus('error')
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setFormatLoading(false)
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
        void handleFormat()
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
            <LineNumberedEditor
              value={editBuffer()}
              originalContent={content()}
              relativePath={normalizedPath()}
              onChange={setEditBuffer}
              setTextareaRef={(el) => {
                textareaRef = el
              }}
              onAddLineComment={props.onAddLineComment}
              findQuery={findQuery()}
              findMatches={findOpen() ? findMatches() : undefined}
              findCurrentIndex={safeMatchIndex()}
              findMatchLines={findOpen() ? findMatchLines() : undefined}
              currentMatchLine={findOpen() ? currentMatchLine() : undefined}
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
                  findQuery={findQuery()}
                  findMatches={findOpen() ? findMatches() : undefined}
                  findCurrentIndex={safeMatchIndex()}
                  findMatchLines={findOpen() ? findMatchLines() : undefined}
                  currentMatchLine={findOpen() ? currentMatchLine() : undefined}
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
