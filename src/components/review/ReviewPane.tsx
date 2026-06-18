import { FileDiff, type FileDiffOptions, parseDiffFromFile, parsePatchFiles } from '@pierre/diffs'
import { ChevronDown, ChevronRight } from 'lucide-solid'
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js'
import type { AgentReviewChange, GitChangedFile, GitFileDiff } from '../../lib/ipc'

type ReviewSource = 'git' | 'last-turn'
type DiffStyle = 'unified' | 'split'
type GitDiffState =
  | { status: 'loading' }
  | { status: 'loaded'; diff: GitFileDiff | null }
  | { status: 'error'; message: string }

type AgentReviewController = {
  changes: AgentReviewChange[]
  activeId: string | null
  activeChange: AgentReviewChange | null
  error: string | null
  setActiveId: (id: string) => void
  keep: (id: string) => Promise<void>
  revert: (id: string) => Promise<void>
  revertAll: () => Promise<void>
  clear: () => Promise<void>
}

type ReviewItem = {
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
}

const REVIEW_DIFF_BACKGROUND = 'var(--surface-card)'
const REVIEW_DIFF_ADDITION_BACKGROUND =
  'color-mix(in srgb, var(--surface-card) 36%, var(--success-soft) 64%)'
const REVIEW_DIFF_ADDITION_NUMBER_BACKGROUND =
  'color-mix(in srgb, var(--success-soft) 72%, var(--success-line) 28%)'
const REVIEW_DIFF_DELETION_BACKGROUND =
  'color-mix(in srgb, var(--surface-card) 34%, var(--error-soft) 66%)'
const REVIEW_DIFF_DELETION_NUMBER_BACKGROUND =
  'color-mix(in srgb, var(--error-soft) 70%, var(--error-line) 30%)'

function applyReviewDiffTheme(node: HTMLElement) {
  node.style.backgroundColor = REVIEW_DIFF_BACKGROUND
  node.style.setProperty('--diffs-bg', REVIEW_DIFF_BACKGROUND)
  node.style.setProperty('--diffs-light-bg', REVIEW_DIFF_BACKGROUND)
  node.style.setProperty('--diffs-dark-bg', REVIEW_DIFF_BACKGROUND)
  node.style.setProperty('--diffs-bg-addition-override', REVIEW_DIFF_ADDITION_BACKGROUND)
  node.style.setProperty(
    '--diffs-bg-addition-number-override',
    REVIEW_DIFF_ADDITION_NUMBER_BACKGROUND
  )
  node.style.setProperty('--diffs-bg-deletion-override', REVIEW_DIFF_DELETION_BACKGROUND)
  node.style.setProperty(
    '--diffs-bg-deletion-number-override',
    REVIEW_DIFF_DELETION_NUMBER_BACKGROUND
  )

  const shadowRoot = node.shadowRoot
  if (!shadowRoot) return

  let style = shadowRoot.querySelector<HTMLStyleElement>('style[data-openpi-review-theme]')
  if (!style) {
    style = document.createElement('style')
    style.dataset.openpiReviewTheme = 'true'
    shadowRoot.appendChild(style)
  }

  style.textContent = `
    :host {
      background-color: ${REVIEW_DIFF_BACKGROUND} !important;
      --diffs-bg: ${REVIEW_DIFF_BACKGROUND} !important;
      --diffs-light-bg: ${REVIEW_DIFF_BACKGROUND} !important;
      --diffs-dark-bg: ${REVIEW_DIFF_BACKGROUND} !important;
      --diffs-bg-addition-override: ${REVIEW_DIFF_ADDITION_BACKGROUND} !important;
      --diffs-bg-addition-number-override: ${REVIEW_DIFF_ADDITION_NUMBER_BACKGROUND} !important;
      --diffs-bg-deletion-override: ${REVIEW_DIFF_DELETION_BACKGROUND} !important;
      --diffs-bg-deletion-number-override: ${REVIEW_DIFF_DELETION_NUMBER_BACKGROUND} !important;
    }

    pre,
    code,
    [data-diff],
    [data-content],
    [data-gutter] {
      background-color: var(--diffs-bg) !important;
    }

    [data-line-type='change-addition']:is([data-line], [data-column-number], [data-gutter-buffer], [data-no-newline]) {
      background-color: ${REVIEW_DIFF_ADDITION_BACKGROUND} !important;
    }

    [data-line-type='change-addition']:is([data-column-number], [data-gutter-buffer]) {
      background-color: ${REVIEW_DIFF_ADDITION_NUMBER_BACKGROUND} !important;
    }

    [data-line-type='change-deletion']:is([data-line], [data-column-number], [data-gutter-buffer], [data-no-newline]) {
      background-color: ${REVIEW_DIFF_DELETION_BACKGROUND} !important;
    }

    [data-line-type='change-deletion']:is([data-column-number], [data-gutter-buffer]) {
      background-color: ${REVIEW_DIFF_DELETION_NUMBER_BACKGROUND} !important;
    }
  `
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
    collapsedContextThreshold: 6,
    expansionLineCount: 120,
    lineDiffType: 'word-alt',
    maxLineDiffLength: 1000,
    tokenizeMaxLineLength: 1000,
    lineHoverHighlight: 'line',
    onPostRender: (node) => applyReviewDiffTheme(node),
  }
}

function statusLabel(status: GitChangedFile['status'] | AgentReviewChange['status']): string {
  if (status === '?') return 'Added'
  if (status === 'A' || status === 'created') return 'Added'
  if (status === 'D' || status === 'deleted') return 'Deleted'
  if (status === 'R') return 'Renamed'
  if (status === 'U') return 'Conflict'
  return 'Modified'
}

function AgentDiffRenderer(props: { change: AgentReviewChange; diffStyle: DiffStyle }) {
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
      if (!diffInstance) diffInstance = new FileDiff(diffOptions(props.diffStyle))
      else diffInstance.setOptions(diffOptions(props.diffStyle))
      diffInstance.render({ fileDiff, containerWrapper: containerRef, forceRender: true })
    } catch {
      containerRef.textContent = change.diff || 'Unable to render diff.'
    }
  })

  onCleanup(() => {
    diffInstance?.cleanUp()
    diffInstance = null
  })

  return <div ref={containerRef!} class="review-diff-renderer" />
}

function GitDiffRenderer(props: {
  path: string
  state: GitDiffState | undefined
  diffStyle: DiffStyle
}) {
  let containerRef!: HTMLDivElement
  let diffInstance: FileDiff<undefined> | null = null

  createEffect(() => {
    const state = props.state
    if (!containerRef) return
    if (!state || state.status === 'loading') {
      containerRef.textContent = 'Loading diff…'
      return
    }
    if (state.status === 'error') {
      containerRef.textContent = state.message
      return
    }
    const diff = state.diff
    if (!diff) {
      containerRef.textContent = 'No diff available.'
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
        return
      }
      if (!diffInstance) diffInstance = new FileDiff(diffOptions(props.diffStyle))
      else diffInstance.setOptions(diffOptions(props.diffStyle))
      diffInstance.render({ fileDiff, containerWrapper: containerRef, forceRender: true })
    } catch {
      containerRef.textContent = diff.rawPatch || 'Unable to render diff.'
    }
  })

  onCleanup(() => {
    diffInstance?.cleanUp()
    diffInstance = null
  })

  return <div ref={containerRef!} class="review-diff-renderer" />
}

export function ReviewPane(props: ReviewPaneProps) {
  const [diffStyle, setDiffStyle] = createSignal<DiffStyle>('unified')
  const [expandedPaths, setExpandedPaths] = createSignal<Set<string>>(new Set())
  const [gitFiles, setGitFiles] = createSignal<GitChangedFile[]>([])
  const [gitDiffs, setGitDiffs] = createSignal<Record<string, GitDiffState>>({})

  const [gitLoading, setGitLoading] = createSignal(false)
  const [gitError, setGitError] = createSignal<string | null>(null)

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
      .getStatus()
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
      .getDiff(path)
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

        <div class="review-toggle-group" role="group" aria-label="Diff layout">
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
              {(item) => {
                const expanded = () => expandedPaths().has(item.path)
                return (
                  <article class={`review-file-card${expanded() ? ' is-expanded' : ''}`}>
                    <button
                      type="button"
                      class="review-file-row"
                      onClick={() => togglePath(item.path)}
                      aria-expanded={expanded()}
                    >
                      <span class="review-file-chevron">
                        <Show when={expanded()} fallback={<ChevronRight size={13} />}>
                          <ChevronDown size={13} />
                        </Show>
                      </span>
                      <span class="review-file-path">{item.path}</span>
                      <span class={`review-file-status is-${item.statusLabel.toLowerCase()}`}>
                        {item.statusLabel}
                      </span>
                      <span class="review-file-delta">
                        <span class="git-delta-add">+{item.added}</span>{' '}
                        <span class="git-delta-rem">−{item.removed}</span>
                      </span>
                    </button>

                    <Show when={expanded()}>
                      <div class="review-file-expanded">
                        <Show when={props.source === 'last-turn' && item.agentChange}>
                          {(change) => (
                            <>
                              <div class="review-file-actions">
                                <button
                                  type="button"
                                  class="review-toolbar-btn"
                                  onClick={() => void props.agentReview.keep(change().id)}
                                >
                                  Keep
                                </button>
                                <button
                                  type="button"
                                  class="review-toolbar-btn is-danger"
                                  onClick={() => void props.agentReview.revert(change().id)}
                                >
                                  Revert
                                </button>
                              </div>
                              <AgentDiffRenderer change={change()} diffStyle={diffStyle()} />
                            </>
                          )}
                        </Show>
                        <Show when={props.source === 'git'}>
                          <GitDiffRenderer
                            path={item.path}
                            state={gitDiffs()[item.path]}
                            diffStyle={diffStyle()}
                          />
                        </Show>
                      </div>
                    </Show>
                  </article>
                )
              }}
            </For>
          </Show>
        </Show>
      </div>
    </section>
  )
}
