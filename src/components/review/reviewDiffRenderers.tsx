import {
  FileDiff,
  type FileDiffOptions,
  parseDiffFromFile,
  parsePatchFiles,
  type SelectedLineRange,
} from '@pierre/diffs'
import { createEffect, onCleanup } from 'solid-js'
import type { AgentReviewChange, GitFileDiff } from '../../lib/ipc'
import { installReviewContentLineSelection } from './reviewContentLineSelection'
import { applyReviewDiffTheme } from './reviewDiffTheme'
import {
  createReviewHoverCommentUtility,
  type ReviewHoveredLine,
} from './reviewHoverCommentUtility'

export type DiffStyle = 'unified' | 'split'

export interface DiffRenderHandlers {
  onLineSelected?: (range: SelectedLineRange | null) => void
  onLineSelectionEnd?: (range: SelectedLineRange | null) => void
  onLineNumberClick?: (range: SelectedLineRange | null) => void
  onHoverCommentSelect?: (range: SelectedLineRange) => void
  onInstance?: (instance: FileDiff<undefined> | null) => void
}

export function diffOptions(
  diffStyle: DiffStyle,
  handlers: DiffRenderHandlers = {}
): FileDiffOptions<undefined> {
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
    collapsedContextThreshold: 6,
    expansionLineCount: 120,
    lineDiffType: 'word-alt',
    maxLineDiffLength: 1000,
    tokenizeMaxLineLength: 1000,
    lineHoverHighlight: 'line',
    enableLineSelection: true,
    enableGutterUtility: true,
    renderGutterUtility: (getHoveredLine) =>
      createReviewHoverCommentUtility({
        label: 'Add comment',
        getHoveredLine: () => getHoveredLine() as ReviewHoveredLine | undefined,
        onSelect: (range) => handlers.onHoverCommentSelect?.(range),
      }),
    onLineSelected: (range) => handlers.onLineSelected?.(range),
    onLineSelectionEnd: (range) => handlers.onLineSelectionEnd?.(range),
    onLineNumberClick: (props) => {
      const data = props as
        | { lineNumber?: number; annotationSide?: 'additions' | 'deletions' }
        | undefined
      handlers.onLineNumberClick?.(
        data?.lineNumber
          ? {
              start: data.lineNumber,
              end: data.lineNumber,
              side: data.annotationSide ?? 'additions',
            }
          : null
      )
    },
    onPostRender: (node, instance) => {
      applyReviewDiffTheme(node)
      installReviewContentLineSelection(node, instance, {
        onLineSelected: (range) => handlers.onLineSelected?.(range),
        onLineSelectionEnd: (range) => handlers.onLineSelectionEnd?.(range),
      })
    },
  }
}

export function AgentDiffRenderer(props: {
  change: AgentReviewChange
  diffStyle: DiffStyle
  handlers: DiffRenderHandlers
}) {
  let containerRef!: HTMLDivElement
  let diffInstance: FileDiff<undefined> | null = null

  createEffect(() => {
    const change = props.change
    if (!containerRef) return
    try {
      containerRef.replaceChildren()
      const fileDiff = parseDiffFromFile(
        {
          name: change.path,
          contents: change.beforeContent ?? '',
          cacheKey: `${change.id}:before`,
        },
        { name: change.path, contents: change.afterContent ?? '', cacheKey: `${change.id}:after` }
      )
      if (!diffInstance) diffInstance = new FileDiff(diffOptions(props.diffStyle, props.handlers))
      else diffInstance.setOptions(diffOptions(props.diffStyle, props.handlers))
      diffInstance.render({ fileDiff, containerWrapper: containerRef, forceRender: true })
      props.handlers.onInstance?.(diffInstance)
    } catch {
      containerRef.textContent = change.diff || 'Unable to render diff.'
      props.handlers.onInstance?.(null)
    }
  })

  onCleanup(() => {
    props.handlers.onInstance?.(null)
    diffInstance?.cleanUp()
    diffInstance = null
  })

  return <div ref={containerRef!} class="review-diff-renderer" />
}

export function GitDiffRenderer(props: {
  path: string
  state:
    | { status: 'loading' | 'loaded' | 'error'; diff?: GitFileDiff | null; message?: string }
    | undefined
  diffStyle: DiffStyle
  handlers: DiffRenderHandlers
}) {
  let containerRef!: HTMLDivElement
  let diffInstance: FileDiff<undefined> | null = null

  createEffect(() => {
    const state = props.state
    if (!containerRef) return
    if (!state || state.status === 'loading') {
      containerRef.textContent = 'Loading diff…'
      props.handlers.onInstance?.(null)
      return
    }
    if (state.status === 'error') {
      containerRef.textContent = state.message ?? 'Unable to load diff.'
      props.handlers.onInstance?.(null)
      return
    }
    const diff = state.diff
    if (!diff) {
      containerRef.textContent = 'No diff available.'
      props.handlers.onInstance?.(null)
      return
    }
    try {
      containerRef.replaceChildren()
      const fileDiff =
        diff.oldContent !== undefined && diff.newContent !== undefined
          ? parseDiffFromFile(
              { name: diff.path, contents: diff.oldContent, cacheKey: `${diff.path}:old` },
              { name: diff.path, contents: diff.newContent, cacheKey: `${diff.path}:new` }
            )
          : parsePatchFiles(diff.rawPatch)[0]?.files[0]
      if (!fileDiff) {
        containerRef.textContent = 'No diff available.'
        props.handlers.onInstance?.(null)
        return
      }
      if (!diffInstance) diffInstance = new FileDiff(diffOptions(props.diffStyle, props.handlers))
      else diffInstance.setOptions(diffOptions(props.diffStyle, props.handlers))
      diffInstance.render({ fileDiff, containerWrapper: containerRef, forceRender: true })
      props.handlers.onInstance?.(diffInstance)
    } catch {
      containerRef.textContent = diff.rawPatch || 'Unable to render diff.'
      props.handlers.onInstance?.(null)
    }
  })

  onCleanup(() => {
    props.handlers.onInstance?.(null)
    diffInstance?.cleanUp()
    diffInstance = null
  })

  return <div ref={containerRef!} class="review-diff-renderer" />
}
