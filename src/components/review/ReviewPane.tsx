import { createEffect, createMemo, createSignal, For, Show } from 'solid-js'
import type { FileLineComment, NewFileLineComment } from '../../lib/fileLineComments'
import type { AgentReviewChange, GitChangedFile } from '../../lib/ipc'
import type { DiffScope } from '../git/DiffScopeSwitcher'
import { ReviewFileCard } from './ReviewFileCard'
import type { DiffStyle } from './reviewDiffRenderers'

type ReviewSource = 'git' | 'last-turn'

type GitDiffState =
  | { status: 'loading' }
  | { status: 'loaded'; diff: import('../../lib/ipc').GitFileDiff | null }
  | { status: 'error'; message: string }

interface AgentReviewController {
  changes: AgentReviewChange[]
  error: string | null
  keep: (id: string) => Promise<void>
  revert: (id: string) => Promise<void>
  keepHunk: (id: string, index: number) => Promise<void>
  revertHunk: (id: string, index: number) => Promise<void>
  revertAll: () => Promise<void>
  clear: () => Promise<void>
}

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

interface ReviewPaneProps {
  cwd: string
  source: ReviewSource
  onSourceChange: (source: ReviewSource) => void
  agentReview: AgentReviewController
  requestedGitPath?: string | null
  comments: FileLineComment[]
  onAddComment: (comment: NewFileLineComment) => void
  onRemoveComment: (id: string) => void
  fileContentFor: (path: string) => string | null
  ensureFileContent: (path: string) => Promise<string | null>
  /* Phase 3: diff scope for hunk action visibility */
  diffScope?: DiffScope
}

function statusLabel(status: GitChangedFile['status'] | AgentReviewChange['status']): string {
  if (status === '?') return 'Added'
  if (status === 'A' || status === 'created') return 'Added'
  if (status === 'D' || status === 'deleted') return 'Deleted'
  if (status === 'R') return 'Renamed'
  if (status === 'U') return 'Conflict'
  return 'Modified'
}

export function ReviewPane(props: ReviewPaneProps) {
  const [diffStyle, setDiffStyle] = createSignal<DiffStyle>('unified')
  const [expandedPaths, setExpandedPaths] = createSignal<Set<string>>(new Set())
  const [gitFiles, setGitFiles] = createSignal<GitChangedFile[]>([])
  const [gitDiffs, setGitDiffs] = createSignal<Record<string, GitDiffState>>({})
  const [gitLoading, setGitLoading] = createSignal(false)
  const [gitError, setGitError] = createSignal<string | null>(null)
  const [activeCommentPath, setActiveCommentPath] = createSignal<string | null>(null)

  const agentItems = createMemo<ReviewItem[]>(() =>
    props.agentReview.changes.map((change) => ({
      id: change.id,
      path: change.path,
      statusLabel: statusLabel(change.status),
      added: change.totalAdded,
      removed: change.totalRemoved,
      kind: 'agent',
      agentChange: change,
    }))
  )

  const gitItems = createMemo<ReviewItem[]>(() =>
    gitFiles().map((file) => ({
      id: `git:${file.path}`,
      path: file.path,
      statusLabel: statusLabel(file.status),
      added: file.added,
      removed: file.removed,
      kind: 'git',
      gitFile: file,
    }))
  )

  const items = createMemo(() => (props.source === 'last-turn' ? agentItems() : gitItems()))
  const hasLastTurn = createMemo(() => props.agentReview.changes.length > 0)

  createEffect(() => {
    if (props.source !== 'git' || !props.cwd) return
    setGitLoading(true)
    setGitError(null)
    window.openpi.git
      .getStatus(props.cwd)
      .then((status) => setGitFiles(status?.files ?? []))
      .catch((err) => setGitError(err instanceof Error ? err.message : String(err)))
      .finally(() => setGitLoading(false))
  })

  createEffect(() => {
    const path = props.requestedGitPath
    if (!path) return
    props.onSourceChange('git')
    setExpandedPaths(new Set([path]))
  })

  createEffect(() => {
    const currentItems = items()
    setExpandedPaths((current) => {
      const available = new Set(currentItems.map((item) => item.path))
      const next = new Set([...current].filter((path) => available.has(path)))
      if (next.size === 0 && currentItems[0]) next.add(currentItems[0].path)
      return next
    })
  })

  const ensureGitDiff = (path: string) => {
    if (props.source !== 'git') return
    const existing = gitDiffs()[path]
    if (existing && existing.status !== 'error') return
    setGitDiffs((prev) => ({ ...prev, [path]: { status: 'loading' } }))
    window.openpi.git
      .getDiff(path, props.cwd)
      .then((diff) => setGitDiffs((prev) => ({ ...prev, [path]: { status: 'loaded', diff } })))
      .catch((err) =>
        setGitDiffs((prev) => ({
          ...prev,
          [path]: {
            status: 'error',
            message: err instanceof Error ? err.message : String(err),
          },
        }))
      )
  }

  createEffect(() => {
    if (props.source !== 'git') return
    for (const path of expandedPaths()) ensureGitDiff(path)
  })

  const togglePath = (path: string) => {
    setExpandedPaths((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
    ensureGitDiff(path)
  }

  // Phase 3: refresh helpers for hunk actions
  // Both are async — callers MUST await them sequentially to avoid
  // concurrent git operations.
  const refreshGitDiff = async (path: string) => {
    setGitDiffs((prev) => ({ ...prev, [path]: { status: 'loading' } }))
    try {
      const diff = await window.openpi.git.getDiff(path, props.cwd)
      setGitDiffs((prev) => ({ ...prev, [path]: { status: 'loaded', diff } }))
    } catch (err) {
      setGitDiffs((prev) => ({
        ...prev,
        [path]: { status: 'error', message: err instanceof Error ? err.message : String(err) },
      }))
    }
  }

  const refreshGitStatus = async () => {
    const status = await window.openpi.git.getStatus(props.cwd)
    setGitFiles(status?.files ?? [])
  }

  // Each handler awaits the mutation, then refreshes diff + status sequentially.
  const handleStageFile = async (path: string) => {
    await window.openpi.git.stage(path)
    await refreshGitDiff(path)
    await refreshGitStatus()
  }
  const handleUnstageFile = async (path: string) => {
    await window.openpi.git.unstage(path)
    await refreshGitDiff(path)
    await refreshGitStatus()
  }
  const handleRevertFile = async (path: string) => {
    await window.openpi.git.discard(path)
    await refreshGitDiff(path)
    await refreshGitStatus()
  }
  const handleStageHunk = async (path: string, hunkPatch: string) => {
    await window.openpi.git.stageHunk({ path, hunkPatch, cwd: props.cwd })
    // gitLock in main thread already serializes; run both refreshes in parallel
    await Promise.all([refreshGitDiff(path), refreshGitStatus()])
  }
  const handleUnstageHunk = async (path: string, hunkPatch: string) => {
    await window.openpi.git.unstageHunk({ path, hunkPatch, cwd: props.cwd })
    await Promise.all([refreshGitDiff(path), refreshGitStatus()])
  }
  const handleRevertHunk = async (path: string, hunkPatch: string) => {
    await window.openpi.git.revertHunk({ path, hunkPatch, cwd: props.cwd })
    await Promise.all([refreshGitDiff(path), refreshGitStatus()])
  }

  const activateComments = (path: string) => {
    setActiveCommentPath(path)
    void props.ensureFileContent(path)
  }

  const collapseAll = () => setExpandedPaths(new Set<string>())
  const expandAll = () => setExpandedPaths(new Set(items().map((item) => item.path)))
  const allCollapsed = createMemo(() => expandedPaths().size === 0)

  const confirmRevertAll = () => {
    const total = props.agentReview.changes.length
    if (total === 0) return
    const confirmed = window.confirm(
      `Revert all ${total} reviewed file change${total === 1 ? '' : 's'}? This restores the captured pre-agent snapshot.`
    )
    if (confirmed) void props.agentReview.revertAll()
  }

  return (
    <section class="review-pane" aria-label="Review changes">
      <header class="review-pane-toolbar">
        <div class="review-source-select-wrap">
          <select
            class="review-source-select"
            value={props.source}
            onChange={(event) => props.onSourceChange(event.currentTarget.value as ReviewSource)}
          >
            <option value="git">Git changes</option>
            <option value="last-turn" disabled={!hasLastTurn()}>
              Last turn changes{hasLastTurn() ? ` (${props.agentReview.changes.length})` : ''}
            </option>
          </select>
        </div>

        <div class="review-toolbar-spacer" />

        <div class="review-toggle-group">
          <button
            type="button"
            class={`review-toggle-btn${diffStyle() === 'unified' ? ' is-active' : ''}`}
            onClick={() => setDiffStyle('unified')}
          >
            Unified
          </button>
          <button
            type="button"
            class={`review-toggle-btn${diffStyle() === 'split' ? ' is-active' : ''}`}
            onClick={() => setDiffStyle('split')}
          >
            Split
          </button>
        </div>
        <button
          type="button"
          class="review-toolbar-btn"
          onClick={() => (allCollapsed() ? expandAll() : collapseAll())}
        >
          {allCollapsed() ? 'Expand all' : 'Collapse all'}
        </button>
        <Show when={props.source === 'last-turn' && hasLastTurn()}>
          <button
            type="button"
            class="review-toolbar-btn"
            onClick={() => void props.agentReview.clear()}
          >
            Keep all
          </button>
          <button type="button" class="review-toolbar-btn is-danger" onClick={confirmRevertAll}>
            Revert all
          </button>
        </Show>
      </header>

      <Show when={props.agentReview.error && props.source === 'last-turn'}>
        {(error) => <div class="review-error">{error()}</div>}
      </Show>
      <Show when={gitError() && props.source === 'git'}>
        {(error) => <div class="review-error">{error()}</div>}
      </Show>

      <div class="review-file-list">
        <Show when={!gitLoading()} fallback={<div class="review-empty">Loading git changes…</div>}>
          <Show
            when={items().length > 0}
            fallback={<div class="review-empty">No changes to review</div>}
          >
            <For each={items()}>
              {(item) => (
                <ReviewFileCard
                  item={item}
                  source={props.source}
                  expanded={expandedPaths().has(item.path)}
                  diffStyle={diffStyle()}
                  gitDiffState={gitDiffs()[item.path]}
                  onToggle={() => togglePath(item.path)}
                  onActivateComments={() => activateComments(item.path)}
                  isCommentActive={activeCommentPath() === item.path}
                  onKeep={async (id) => props.agentReview.keep(id)}
                  onRevert={async (id) => props.agentReview.revert(id)}
                  onKeepReviewHunk={async (id, index) => props.agentReview.keepHunk(id, index)}
                  onRevertReviewHunk={async (id, index) => props.agentReview.revertHunk(id, index)}
                  comments={props.comments}
                  onAddComment={props.onAddComment}
                  onRemoveComment={props.onRemoveComment}
                  fileContentFor={props.fileContentFor}
                  ensureFileContent={props.ensureFileContent}
                  diffScope={props.diffScope}
                  isStaged={item.gitFile?.staged ?? false}
                  onStageFile={() => handleStageFile(item.path)}
                  onUnstageFile={() => handleUnstageFile(item.path)}
                  onRevertFile={() => handleRevertFile(item.path)}
                  onStageHunk={(patch) => handleStageHunk(item.path, patch)}
                  onUnstageHunk={(patch) => handleUnstageHunk(item.path, patch)}
                  onRevertHunk={(patch) => handleRevertHunk(item.path, patch)}
                />
              )}
            </For>
          </Show>
        </Show>
      </div>
    </section>
  )
}
