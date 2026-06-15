/**
 * DiffViewer — Review tab diff viewer.
 *
 * Uses @pierre/diffs vanilla JS FileDiff component for robust configurable rendering,
 * syntax highlighting via Shiki, and proper hunk structure.
 *
 * Authority: renderer only — no Git mutations here.
 */

import { FileDiff, type FileDiffOptions, parseDiffFromFile, parsePatchFiles } from '@pierre/diffs'
import { createEffect, createSignal, onCleanup, Show } from 'solid-js'
import type { GitChangedFile, GitFileDiff } from '../../lib/ipc'

interface DiffViewerProps {
  diff: GitFileDiff
  allFiles: GitChangedFile[]
  currentIndex: number
  onNavigate: (index: number) => void
  onClose: () => void
}

type DiffStyle = 'split' | 'unified'

const DIFF_STYLE_STORAGE_KEY = 'openpi:review-diff-style'

function readDiffStyle(): DiffStyle {
  return window.localStorage.getItem(DIFF_STYLE_STORAGE_KEY) === 'unified' ? 'unified' : 'split'
}

function diffOptions(diffStyle: DiffStyle): FileDiffOptions<undefined> {
  return {
    diffStyle,
    theme: 'pierre-dark',
    themeType: 'dark',
    preferredHighlighter: 'shiki-js',
    disableFileHeader: true,
    disableLineNumbers: false,
    overflow: 'wrap',
    diffIndicators: 'bars',
    disableBackground: false,
    hunkSeparators: 'line-info-basic',
    collapsedContextThreshold: 3,
    expansionLineCount: 80,
    lineDiffType: 'word-alt',
    maxLineDiffLength: 1000,
    tokenizeMaxLineLength: 1000,
    lineHoverHighlight: 'line',
  }
}

// ─── Keyboard handler ──────────────────────────────────────────────────────

function useKeyboardNav(
  currentIndex: () => number,
  totalFiles: () => number,
  onNavigate: (i: number) => void,
  onClose: () => void
) {
  createEffect(() => {
    const idx = currentIndex()
    const total = totalFiles()
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key === 'ArrowLeft' && idx > 0) onNavigate(idx - 1)
      if (e.key === 'ArrowRight' && idx < total - 1) onNavigate(idx + 1)
    }
    window.addEventListener('keydown', handler)
    onCleanup(() => window.removeEventListener('keydown', handler))
  })
}

// ─── Pierre diff renderer ─────────────────────────────────────────────────

function PierreDiffRenderer(props: { diff: GitFileDiff; diffStyle: DiffStyle }) {
  let containerRef!: HTMLDivElement
  let diffInstance: FileDiff<undefined> | null = null

  const renderDiff = (diff: GitFileDiff, style: DiffStyle) => {
    if (!containerRef) return

    let fileDiff: ReturnType<typeof parsePatchFiles>[number]['files'][number] | undefined
    try {
      if (diff.oldContent !== undefined && diff.newContent !== undefined) {
        fileDiff = parseDiffFromFile(
          { name: diff.path, contents: diff.oldContent, cacheKey: `${diff.path}:old` },
          { name: diff.path, contents: diff.newContent, cacheKey: `${diff.path}:new` }
        )
      } else {
        const parsed = parsePatchFiles(diff.rawPatch)
        fileDiff = parsed[0]?.files[0]
      }
    } catch (err) {
      console.warn('[DiffViewer] Failed to parse diff:', err)
      containerRef.innerHTML = '<div class="diff-empty">Unable to parse diff.</div>'
      return
    }

    if (!fileDiff) {
      containerRef.innerHTML = '<div class="diff-empty">No changes detected.</div>'
      return
    }

    const options = diffOptions(style)
    if (!diffInstance) {
      diffInstance = new FileDiff(options)
    } else {
      diffInstance.setOptions(options)
    }

    try {
      diffInstance.render({ fileDiff, containerWrapper: containerRef, forceRender: true })
    } catch (err) {
      console.error('[DiffViewer] render error:', err)
      containerRef.innerHTML = '<div class="diff-empty">Failed to render diff.</div>'
    }
  }

  // Re-render when diff data or display options change.
  // Use containerWrapper (not fileContainer) so @pierre/diffs creates its own
  // <diffs-container> shadow host with the correct split/unified layout semantics.
  createEffect(() => {
    renderDiff(props.diff, props.diffStyle)
  })

  onCleanup(() => {
    if (diffInstance) {
      diffInstance.cleanUp()
      diffInstance = null
    }
  })

  return <div ref={containerRef!} class="pierre-diff-container" />
}

// ─── DiffViewer ────────────────────────────────────────────────────────────

export function DiffViewer(props: DiffViewerProps) {
  const [copyDone, setCopyDone] = createSignal(false)
  const [diffStyle, setDiffStyle] = createSignal<DiffStyle>(readDiffStyle())

  createEffect(() => {
    window.localStorage.setItem(DIFF_STYLE_STORAGE_KEY, diffStyle())
  })

  useKeyboardNav(
    () => props.currentIndex,
    () => props.allFiles.length,
    props.onNavigate,
    props.onClose
  )

  const copyPath = () => {
    void navigator.clipboard.writeText(props.diff.path)
    setCopyDone(true)
    setTimeout(() => setCopyDone(false), 1200)
  }

  const parts = () => props.diff.path.split('/')
  const filename = () => {
    const p = parts()
    return p.pop() ?? props.diff.path
  }
  const dir = () => {
    const p = parts()
    p.pop()
    return p.join('/') || null
  }
  const hasDiffData = () =>
    Boolean(
      props.diff.rawPatch ||
        (props.diff.oldContent !== undefined && props.diff.newContent !== undefined)
    )

  return (
    <div class="diff-overlay" aria-label="Diff viewer">
      <div class="diff-header">
        <div class="diff-nav">
          <button
            type="button"
            class="diff-nav-btn"
            onClick={() => props.onNavigate(props.currentIndex - 1)}
            disabled={props.currentIndex === 0}
            title="Previous file (←)"
          >
            ←
          </button>
          <span class="diff-nav-counter">
            {props.currentIndex + 1} of {props.allFiles.length}
          </span>
          <button
            type="button"
            class="diff-nav-btn"
            onClick={() => props.onNavigate(props.currentIndex + 1)}
            disabled={props.currentIndex >= props.allFiles.length - 1}
            title="Next file (→)"
          >
            →
          </button>
        </div>

        <button type="button" class="diff-filepath" onClick={copyPath} title="Click to copy path">
          <Show when={dir()}>
            <span class="diff-filepath-dir">{dir()}/</span>
          </Show>
          <span class="diff-filepath-name">{filename()}</span>
          <Show when={props.diff.totalAdded > 0 || props.diff.totalRemoved > 0}>
            <span class="diff-filepath-delta">
              <span class="git-delta-add">+{props.diff.totalAdded}</span>{' '}
              <span class="git-delta-rem">-{props.diff.totalRemoved}</span>
            </span>
          </Show>
          <Show when={copyDone()}>
            <span class="diff-copy-flash"> copied</span>
          </Show>
        </button>

        <div class="diff-actions" aria-label="Review display controls">
          <div class="diff-style-toggle" role="group" aria-label="Diff layout">
            <button
              type="button"
              class={`diff-toggle-btn${diffStyle() === 'split' ? ' is-active' : ''}`}
              aria-pressed={diffStyle() === 'split'}
              onClick={() => setDiffStyle('split')}
            >
              Split
            </button>
            <button
              type="button"
              class={`diff-toggle-btn${diffStyle() === 'unified' ? ' is-active' : ''}`}
              aria-pressed={diffStyle() === 'unified'}
              onClick={() => setDiffStyle('unified')}
            >
              Unified
            </button>
          </div>
          <button type="button" class="diff-close-btn" onClick={props.onClose} title="Close (Esc)">
            ✕
          </button>
        </div>
      </div>

      <div class="diff-body">
        <Show
          when={hasDiffData()}
          fallback={<div class="diff-empty">No diff available for this file.</div>}
        >
          <PierreDiffRenderer diff={props.diff} diffStyle={diffStyle()} />
        </Show>
      </div>
    </div>
  )
}
