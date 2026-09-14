import type { DiffLineAnnotation, FileDiff, SelectedLineRange } from '@pierre/diffs'
import { ChevronDown, ChevronRight } from 'lucide-solid'
import { createEffect, createMemo, createSignal, For, Show } from 'solid-js'
import {
  type ReviewLineAnnotationMeta,
  useReviewLineComments,
} from '../../hooks/useReviewLineComments'
import type { FileLineComment, NewFileLineComment } from '../../lib/fileLineComments'
import type { AgentReviewChange, GitChangedFile, GitFileDiff } from '../../lib/ipc'
import type { DiffScope } from '../git/DiffScopeSwitcher'
import { GitHunkActions } from '../git/GitHunkActions'
import { ReviewHunkActions } from './ReviewHunkActions'
import { ReviewLineCommentAnnotation } from './ReviewLineCommentAnnotation'
import { ReviewLineCommentChip } from './ReviewLineCommentChip'
import {
  AgentDiffRenderer,
  type DiffRenderHandlers,
  type DiffStyle,
  GitDiffRenderer,
} from './reviewDiffRenderers'

type ReviewSource = 'git' | 'last-turn'

type GitDiffState =
  | { status: 'loading' }
  | { status: 'loaded'; diff: GitFileDiff | null }
  | { status: 'error'; message: string }

interface ReviewItem {
  id: string
  path: string
  statusLabel: string
  added: number
  removed: number
  kind: 'git' | 'agent'
  gitFile?: GitChangedFile
  agentChange?: AgentReviewChange
}

export interface ReviewFileCardProps {
  item: ReviewItem
  source: ReviewSource
  expanded: boolean
  diffStyle: DiffStyle
  gitDiffState: GitDiffState | undefined
  onToggle: () => void
  onActivateComments: () => void
  isCommentActive: boolean
  onKeep: (id: string) => Promise<void>
  onRevert: (id: string) => Promise<void>
  /** Hunk-level review of the last-turn diff (index-based; main owns the snapshots). */
  onKeepReviewHunk: (id: string, index: number) => Promise<void>
  onRevertReviewHunk: (id: string, index: number) => Promise<void>
  comments: FileLineComment[]
  onAddComment: (comment: NewFileLineComment) => void
  onRemoveComment: (id: string) => void
  fileContentFor: (path: string) => string | null
  ensureFileContent: (path: string) => Promise<string | null>
  /* Phase 3: hunk-level git actions */
  diffScope?: DiffScope
  isStaged?: boolean
  onStageFile?: () => void | Promise<void>
  onUnstageFile?: () => void | Promise<void>
  onRevertFile?: () => void | Promise<void>
  onStageHunk?: (hunkPatch: string) => void | Promise<void>
  onUnstageHunk?: (hunkPatch: string) => void | Promise<void>
  onRevertHunk?: (hunkPatch: string) => void | Promise<void>
}

function lineRangeLabel(range: SelectedLineRange): string {
  const start = Math.min(range.start, range.end)
  const end = Math.max(range.start, range.end)
  return start === end ? `line ${start}` : `lines ${start}-${end}`
}

function rangeContainsLine(range: SelectedLineRange, line: SelectedLineRange): boolean {
  const start = Math.min(range.start, range.end)
  const end = Math.max(range.start, range.end)
  const lineNumber = line.start
  const lineSide = line.side ?? 'additions'
  const startSide = range.side ?? range.endSide ?? 'additions'
  const endSide = range.endSide ?? startSide
  const sameSide = startSide === endSide ? lineSide === startSide : true
  return lineNumber >= start && lineNumber <= end && sameSide
}

export function ReviewFileCard(props: ReviewFileCardProps) {
  const [diffInstance, setDiffInstance] = createSignal<FileDiff<undefined> | null>(null)
  const loadedGitDiff = createMemo(() => {
    if (props.gitDiffState?.status === 'loaded') return props.gitDiffState.diff
    return null
  })
  const controller = useReviewLineComments({
    filePath: props.item.path,
    fileContent: () => {
      if (props.isCommentActive) {
        const fromFile = props.fileContentFor(props.item.path)
        if (fromFile) return fromFile
      }
      // Fallback: use the diff content already loaded for the review view.
      // The diff view always has the full new/old content for line extraction.
      const diff = loadedGitDiff()
      return diff?.newContent ?? diff?.oldContent ?? null
    },
    comments: () => props.comments,
    onAdd: props.onAddComment,
    onRemove: props.onRemoveComment,
  })

  const handlers: DiffRenderHandlers = {
    onInstance: setDiffInstance,
    onLineSelected: (range) => {
      props.onActivateComments()
      if (range) {
        void props.ensureFileContent(props.item.path).then(() => {
          controller.handleLineSelected(range)
        })
        return
      }
      controller.handleLineSelected(range)
    },
    onLineSelectionEnd: (range) => {
      props.onActivateComments()
      if (!range) controller.clearDraft()
    },
    onLineNumberClick: (range) => {
      props.onActivateComments()
      if (range) {
        void props.ensureFileContent(props.item.path).then(() => {
          controller.handleLineSelected(range)
        })
      }
    },
    onHoverCommentSelect: (range) => {
      props.onActivateComments()
      void props.ensureFileContent(props.item.path).then(() => {
        const current = controller.draft()
        if (current && rangeContainsLine(current.range, range)) {
          controller.handleLineSelected(current.range)
          return
        }
        controller.handleLineSelected(range)
      })
    },
  }

  // Sync Pierre's selection to the controller's draft so the selected
  // line(s) are highlighted in the diff.
  createEffect(() => {
    const instance = diffInstance()
    const draft = controller.draft()
    if (!instance) return
    if (draft) {
      instance.setSelectedLines(draft.range)
    } else {
      instance.setSelectedLines(null)
    }
  })

  const metaByLine = createMemo(() => {
    const map = new Map<string, ReviewLineAnnotationMeta>()
    for (const a of controller.annotations()) {
      const side = a.side ?? 'additions'
      map.set(`${side}:${a.lineNumber}`, a.metadata)
    }
    return map
  })

  return (
    <article class={`review-file-card${props.expanded ? ' is-expanded' : ''}`}>
      <button
        type="button"
        class="review-file-row"
        onClick={props.onToggle}
        aria-expanded={props.expanded}
      >
        <span class="review-file-chevron">
          <Show when={props.expanded} fallback={<ChevronRight size={13} />}>
            <ChevronDown size={13} />
          </Show>
        </span>
        <span class="review-file-path">{props.item.path}</span>
        <span class={`review-file-status is-${props.item.statusLabel.toLowerCase()}`}>
          {props.item.statusLabel}
        </span>
        <span class="review-file-delta">
          <span class="git-delta-add">+{props.item.added}</span>{' '}
          <span class="git-delta-rem">−{props.item.removed}</span>
        </span>
      </button>

      <Show when={props.expanded}>
        <div class="review-file-expanded">
          <Show when={props.source === 'last-turn' && props.item.agentChange}>
            {(change) => (
              <>
                <div class="review-file-actions">
                  <button
                    type="button"
                    class="review-toolbar-btn"
                    onClick={() => void props.onKeep(change().id)}
                  >
                    Keep
                  </button>
                  <button
                    type="button"
                    class="review-toolbar-btn is-danger"
                    onClick={() => void props.onRevert(change().id)}
                  >
                    Revert
                  </button>
                </div>
                <Show when={change().status === 'modified' && change().hunks.length > 1}>
                  <ReviewHunkActions
                    change={change()}
                    onKeepHunk={(index) => props.onKeepReviewHunk(change().id, index)}
                    onRevertHunk={(index) => props.onRevertReviewHunk(change().id, index)}
                  />
                </Show>
                <AgentDiffRenderer
                  change={change()}
                  diffStyle={props.diffStyle}
                  handlers={handlers}
                />
                <ReviewAnnotationList
                  annotations={controller.annotations()}
                  metaByLine={metaByLine}
                  onSaveDraft={controller.saveDraft}
                  onCancelDraft={controller.clearDraft}
                  onRemoveComment={(id) => props.onRemoveComment(id)}
                />
              </>
            )}
          </Show>
          <Show when={props.source === 'git'}>
            <Show when={loadedGitDiff() && props.onStageHunk}>
              <div class="diff-git-actions">
                <GitHunkActions
                  diff={loadedGitDiff()!}
                  scope={props.diffScope ?? 'unstaged'}
                  isStaged={props.isStaged ?? false}
                  confirm={(action, detail) => window.confirm(`${action}\n\n${detail}`)}
                  onStageFile={() => props.onStageFile?.()}
                  onUnstageFile={() => props.onUnstageFile?.()}
                  onRevertFile={() => props.onRevertFile?.()}
                  onStageHunk={(patch) => props.onStageHunk?.(patch)}
                  onUnstageHunk={(patch) => props.onUnstageHunk?.(patch)}
                  onRevertHunk={(patch) => props.onRevertHunk?.(patch)}
                />
              </div>
            </Show>
            <GitDiffRenderer
              path={props.item.path}
              state={props.gitDiffState}
              diffStyle={props.diffStyle}
              handlers={handlers}
            />
            <ReviewAnnotationList
              annotations={controller.annotations()}
              metaByLine={metaByLine}
              onSaveDraft={controller.saveDraft}
              onCancelDraft={controller.clearDraft}
              onRemoveComment={(id) => props.onRemoveComment(id)}
            />
          </Show>
        </div>
      </Show>
    </article>
  )
}

function ReviewAnnotationList(props: {
  annotations: DiffLineAnnotation<ReviewLineAnnotationMeta>[]
  metaByLine: ReturnType<typeof createMemo<Map<string, ReviewLineAnnotationMeta>>>
  onSaveDraft: (text: string) => void
  onCancelDraft: () => void
  onRemoveComment: (id: string) => void
}) {
  // Dedupe annotations to one card per meta key
  const unique = createMemo(() => {
    const seen = new Set<string>()
    const out: ReviewLineAnnotationMeta[] = []
    for (const a of props.annotations) {
      if (seen.has(a.metadata.key)) continue
      seen.add(a.metadata.key)
      out.push(a.metadata)
    }
    return out
  })

  return (
    <div class="review-line-annotation-list" hidden={unique().length === 0}>
      <Show when={unique().length > 0}>
        <For each={unique()}>
          {(meta) => {
            if (meta.kind === 'draft') {
              return (
                <ReviewLineCommentAnnotation
                  comment=""
                  side={meta.range.side === 'deletions' ? 'deletions' : 'additions'}
                  lineLabel={lineRangeLabel(meta.range)}
                  preview={meta.preview}
                  onSave={(text) => props.onSaveDraft(text)}
                  onCancel={() => props.onCancelDraft()}
                />
              )
            }
            return (
              <ReviewLineCommentChip
                comment={{
                  id: meta.comment.id,
                  path: '',
                  startLine: meta.comment.selection.start,
                  endLine: meta.comment.selection.end,
                  side: meta.comment.selection.side === 'deletions' ? 'deletions' : 'additions',
                  source: 'review',
                  snippet: meta.comment.preview ?? '',
                  comment: meta.comment.text,
                }}
                onRemove={(id) => props.onRemoveComment(id)}
              />
            )
          }}
        </For>
      </Show>
    </div>
  )
}
