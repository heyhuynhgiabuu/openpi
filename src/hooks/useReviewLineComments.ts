import type { DiffLineAnnotation, SelectedLineRange } from '@pierre/diffs'
import { createMemo, createSignal } from 'solid-js'
import { buildDiffLineSnippet } from '../lib/diffLineSnippet'
import {
  type FileLineComment,
  formatLineRange,
  type NewFileLineComment,
} from '../lib/fileLineComments'

export interface ReviewLineComment {
  id: string
  selection: SelectedLineRange
  text: string
  preview?: string
}

export type ReviewDraftAnnotation = {
  kind: 'draft'
  key: string
  range: SelectedLineRange
  preview?: string
}

export type ReviewCommentAnnotation = {
  kind: 'comment'
  key: string
  comment: ReviewLineComment
}

export type ReviewLineAnnotationMeta = ReviewDraftAnnotation | ReviewCommentAnnotation

export interface UseReviewLineCommentsOptions {
  filePath: string
  fileContent: () => string | null
  comments: () => FileLineComment[]
  onAdd: (comment: NewFileLineComment) => void
  onRemove: (id: string) => void
}

export interface UseReviewLineCommentsResult {
  annotations: () => DiffLineAnnotation<ReviewLineAnnotationMeta>[]
  draft: () => ReviewDraftAnnotation | null
  setDraft: (range: SelectedLineRange | null, preview?: string) => void
  clearDraft: () => void
  saveDraft: (text: string) => void
  handleLineSelected: (range: SelectedLineRange | null) => void
}

function sanitizeReviewLineRange(range: SelectedLineRange): SelectedLineRange {
  const side = range.side ?? 'additions'
  const endSide = range.endSide ?? side
  if (side !== endSide) {
    return { start: range.start, end: range.start, side }
  }
  return { ...range, side }
}

function normalizeRange(range: SelectedLineRange): {
  start: number
  end: number
  side: 'additions' | 'deletions'
} {
  const safeRange = sanitizeReviewLineRange(range)
  const start = Math.min(safeRange.start, safeRange.end)
  const end = Math.max(safeRange.start, safeRange.end)
  const side = safeRange.side === 'deletions' ? 'deletions' : 'additions'
  return { start, end, side }
}

function lineLabel(range: SelectedLineRange): string {
  const { start, end } = normalizeRange(range)
  return formatLineRange(start, end)
}

function draftKeyFor(path: string, range: SelectedLineRange): string {
  const { start, end, side } = normalizeRange(range)
  return `draft:${path}:${side}:${start}:${end}`
}

function commentKeyFor(path: string, id: string): string {
  return `comment:${path}:${id}`
}

function buildDraftPreview(
  fileContent: string | null,
  range: SelectedLineRange
): string | undefined {
  if (!fileContent) return undefined
  const { start, end } = normalizeRange(range)
  const snippet = buildDiffLineSnippet({ text: fileContent, startLine: start, endLine: end })
  return snippet || undefined
}

export function useReviewLineComments(
  options: UseReviewLineCommentsOptions
): UseReviewLineCommentsResult {
  const [draft, setDraftSignal] = createSignal<ReviewDraftAnnotation | null>(null)

  const fileComments = createMemo(() =>
    options.comments().filter((comment) => comment.path === options.filePath)
  )

  const setDraft = (range: SelectedLineRange | null, preview?: string) => {
    if (!range) {
      setDraftSignal(null)
      return
    }
    const safeRange = sanitizeReviewLineRange(range)
    const resolvedPreview = preview ?? buildDraftPreview(options.fileContent(), safeRange)

    setDraftSignal({
      kind: 'draft',
      key: draftKeyFor(options.filePath, safeRange),
      range: safeRange,
      preview: resolvedPreview,
    })
  }

  const clearDraft = () => setDraftSignal(null)

  const saveDraft = (text: string) => {
    const current = draft()
    if (!current) return
    const { start, end, side } = normalizeRange(current.range)
    const snippet = current.preview ?? buildDraftPreview(options.fileContent(), current.range) ?? ''
    options.onAdd({
      path: options.filePath,
      startLine: start,
      endLine: end,
      side,
      source: 'review',
      comment: text,
      snippet,
    })
    setDraftSignal(null)
  }

  const handleLineSelected = (range: SelectedLineRange | null) => {
    if (!range) {
      setDraftSignal(null)
      return
    }
    const safeRange = sanitizeReviewLineRange(range)
    const preview = buildDraftPreview(options.fileContent(), safeRange)
    setDraft(safeRange, preview)
  }

  const annotations = createMemo<DiffLineAnnotation<ReviewLineAnnotationMeta>[]>(() => {
    const result: DiffLineAnnotation<ReviewLineAnnotationMeta>[] = []
    const current = draft()
    if (current) {
      const { start, end, side } = normalizeRange(current.range)
      for (let line = start; line <= end; line += 1) {
        result.push({
          lineNumber: line,
          side,
          metadata: current,
        })
      }
    }
    for (const comment of fileComments()) {
      const { start, end, side } = normalizeRange({
        start: comment.startLine,
        end: comment.endLine,
        side: comment.side === 'deletions' ? 'deletions' : 'additions',
      })
      for (let line = start; line <= end; line += 1) {
        result.push({
          lineNumber: line,
          side,
          metadata: {
            kind: 'comment',
            key: commentKeyFor(options.filePath, comment.id),
            comment: {
              id: comment.id,
              selection: {
                start: comment.startLine,
                end: comment.endLine,
                side,
              },
              text: comment.comment,
              preview: comment.snippet,
            },
          },
        })
      }
    }
    return result
  })

  return {
    annotations,
    draft,
    setDraft,
    clearDraft,
    saveDraft,
    handleLineSelected,
  }
}

export { commentKeyFor, draftKeyFor, lineLabel, normalizeRange, sanitizeReviewLineRange }
