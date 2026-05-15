/**
 * GitPanel — persistent right-side source control panel.
 *
 * Authority boundary: renderer collects intent only.
 * ALL git mutations go through window.openpi.git.* → Electron main.
 */

import { ArrowUp, ArrowUpDown, ChevronDown, GripVertical, Search, Sparkles } from 'lucide-solid'
import { createEffect, createMemo, createSignal, For, onMount, Show } from 'solid-js'
import { Portal } from 'solid-js/web'

import type {
  GitChangedFile,
  GitFileDiff,
  GitHistoryCommit,
  GitHistoryResult,
  GitStatusResult,
  GitSyncAction,
} from '../../lib/ipc'
import { ConflictResolverModal } from './ConflictResolverModal'

type GitPanelTab = 'changes' | 'history'

interface GitPanelProps {
  style?: string | Record<string, string>
  cwd: string | null
  activeTab?: GitPanelTab
  onActiveTabChange?: (tab: GitPanelTab) => void
  onRequestFileSearch?: () => void
  onDiffOpen: (diff: GitFileDiff, files: GitChangedFile[], index: number) => void
  onFileClick?: (relPath: string) => void
  /** Called on mousedown of the drag grip; parent handles the drag lifecycle. */
  onDragHandleMouseDown?: (e: MouseEvent) => void
  /** Which side of the main pane the panel is on — controls border direction. */
  side?: 'left' | 'right'
  /** Called whenever the local branch label changes — surfaces it in the TopBar. */
  onBranchLabelChange?: (label: string) => void
  /** Called whenever the upstream/sync label changes — surfaces it in the TopBar. */
  onSyncLabelChange?: (label: string) => void
  /** Called when the active sync action changes (null = idle). */
  onSyncActionChange?: (action: GitSyncAction | null) => void
  /** Called when the sync result message changes. */
  onSyncMessageChange?: (msg: string | null) => void
}

const STATUS_LABEL: Record<string, string> = {
  M: 'M',
  A: 'A',
  D: 'D',
  R: 'R',
  '?': '?',
  U: 'U',
}

const STATUS_CLASS: Record<string, string> = {
  M: 'git-badge-m',
  A: 'git-badge-a',
  D: 'git-badge-d',
  R: 'git-badge-r',
  '?': 'git-badge-u',
  U: 'git-badge-conflict',
}

export function GitPanel(props: GitPanelProps) {
  const [status, setStatus] = createSignal<GitStatusResult | null>(null)
  const [commitMessage, setCommitMessage] = createSignal('')
  const [isCommitting, setIsCommitting] = createSignal(false)
  const [isGeneratingMsg, setIsGeneratingMsg] = createSignal(false)
  const [agentChangedCount, setAgentChangedCount] = createSignal<number | null>(null)
  const [commitOptionsOpen, setCommitOptionsOpen] = createSignal(false)
  const [commitAmend, setCommitAmend] = createSignal(false)
  const [commitSignoff, setCommitSignoff] = createSignal(false)
  const [syncingAction, setSyncingAction] = createSignal<GitSyncAction | null>(null)
  const [syncMenuOpen, setSyncMenuOpen] = createSignal(false)
  let syncBtnRef: HTMLButtonElement | undefined
  const [syncMenuAnchor, setSyncMenuAnchor] = createSignal<DOMRect | null>(null)
  const [commitError, setCommitError] = createSignal<string | null>(null)
  const [syncMessage, setSyncMessage] = createSignal<string | null>(null)
  const [loadingDiff, setLoadingDiff] = createSignal<string | null>(null)
  const [history, setHistory] = createSignal<GitHistoryResult | null>(null)
  const [historyQuery, setHistoryQuery] = createSignal('')
  const [historyLoading, setHistoryLoading] = createSignal(false)
  const [historyError, setHistoryError] = createSignal<string | null>(null)
  const [selectedCommit, setSelectedCommit] = createSignal<GitHistoryCommit | null>(null)
  const [localActiveTab, setLocalActiveTab] = createSignal<GitPanelTab>('changes')
  const [conflictPath, setConflictPath] = createSignal<string | null>(null)
  let mounted = true

  const activeTab = () => props.activeTab ?? localActiveTab()
  const setActiveTab = (tab: GitPanelTab) => {
    props.onActiveTabChange?.(tab)
    setLocalActiveTab(tab)
  }

  onMount(() => {
    window.openpi.notifyGitPanelMounted()
    // Listen for agent-changed-files events from main process
    const unsub = window.openpi.git.onAgentChangedFiles((count) => {
      setAgentChangedCount(count)
    })
    return unsub
  })

  // Surface branch + upstream labels up to the parent (→ TopBar via App).
  createEffect(() => {
    props.onBranchLabelChange?.(branchLabel())
  })
  createEffect(() => {
    props.onSyncLabelChange?.(syncLabel())
  })
  // Surface sync action + message to BottomBar via App.
  createEffect(() => {
    props.onSyncActionChange?.(syncingAction())
  })
  createEffect(() => {
    props.onSyncMessageChange?.(syncMessage())
  })

  createEffect(() => {
    props.cwd
    mounted = true

    const unsub = window.openpi.git.onStatusChanged((nextStatus) => {
      if (mounted) setStatus(nextStatus)
    })

    if (props.cwd) {
      void window.openpi.git.getStatus().then((nextStatus) => {
        if (nextStatus && mounted) setStatus(nextStatus)
      })
    }

    return () => {
      mounted = false
      unsub()
    }
  })

  const loadHistory = async (query = historyQuery()) => {
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      const result = await window.openpi.git.getHistory(query, 100)
      if (mounted && result) setHistory(result)
    } catch (err) {
      if (mounted) setHistoryError(String(err))
    } finally {
      if (mounted) setHistoryLoading(false)
    }
  }

  createEffect(() => {
    if (activeTab() === 'history' && props.cwd) void loadHistory()
  })

  const handleFileClick = async (file: GitChangedFile) => {
    const current = status()
    if (!current) return

    if (file.status === 'U') {
      setConflictPath(file.path)
      return
    }

    setLoadingDiff(file.path)
    try {
      const diff = await window.openpi.git.getDiff(file.path)
      if (diff && mounted) {
        const idx = current.files.indexOf(file)
        props.onDiffOpen(diff, current.files, idx)
      }
    } finally {
      if (mounted) setLoadingDiff(null)
    }
  }

  const handleStageToggle = async (file: GitChangedFile, e: Event) => {
    e.stopPropagation()
    try {
      if (file.staged) {
        await window.openpi.git.unstage(file.path)
      } else {
        await window.openpi.git.stage(file.path)
      }
      const nextStatus = await window.openpi.git.getStatus()
      if (nextStatus && mounted) setStatus(nextStatus)
    } catch (err) {
      if (mounted) setCommitError(String(err))
    }
  }

  const handleStageAll = async () => {
    const current = status()
    if (!current) return

    const unstaged = current.files.filter((f) => !f.staged && f.status !== 'U')
    for (const file of unstaged) {
      await window.openpi.git.stage(file.path)
    }
    const nextStatus = await window.openpi.git.getStatus()
    if (nextStatus && mounted) setStatus(nextStatus)
  }

  const handleSync = async (action: GitSyncAction) => {
    const current = status()
    if (!current || syncingAction()) return
    if (action !== 'fetch' && !current.upstream) {
      setSyncMessage('Set an upstream before pulling or pushing.')
      return
    }
    if ((action === 'pull' || action === 'pull-rebase') && totalChanged() > 0) {
      setSyncMessage('Commit, stash, or discard local changes before pulling.')
      return
    }

    setSyncingAction(action)
    setSyncMessage(null)
    try {
      const result = await window.openpi.git.sync(action)
      if (!mounted || !result) return
      setSyncMessage(result.output)
      const nextStatus = await window.openpi.git.getStatus()
      if (nextStatus) setStatus(nextStatus)
    } catch (err) {
      if (mounted) setSyncMessage(String(err))
    } finally {
      if (mounted) setSyncingAction(null)
    }
  }

  const handleGenerateCommitMessage = async () => {
    setIsGeneratingMsg(true)
    try {
      const result = await window.openpi.git.generateCommitMessage()
      if (result?.message) setCommitMessage(result.message)
    } catch (err) {
      console.error('Failed to generate commit message:', err)
    } finally {
      setIsGeneratingMsg(false)
    }
  }

  const handleCommit = async (push = false) => {
    const current = status()
    const message = commitMessage().trim()
    if (!current || !message) return

    const staged = current.files.filter((f) => f.staged).map((f) => f.path)
    if (staged.length === 0) {
      setCommitError('No staged changes. Check files to stage them.')
      return
    }

    setIsCommitting(true)
    setCommitError(null)

    try {
      await window.openpi.git.commit(staged, message, push, {
        amend: commitAmend(),
        signoff: commitSignoff(),
      })
      if (mounted) {
        setCommitMessage('')
        setCommitOptionsOpen(false)
        setCommitAmend(false)
        setCommitSignoff(false)
        const nextStatus = await window.openpi.git.getStatus()
        if (nextStatus) setStatus(nextStatus)
      }
    } catch (err) {
      if (mounted) setCommitError(String(err))
    } finally {
      if (mounted) setIsCommitting(false)
    }
  }

  const conflictFiles = createMemo(() => status()?.files.filter((f) => f.status === 'U') ?? [])
  const stagedFiles = createMemo(
    () => status()?.files.filter((f) => f.staged && f.status !== 'U') ?? []
  )
  const unstagedFiles = createMemo(
    () => status()?.files.filter((f) => !f.staged && f.status !== '?' && f.status !== 'U') ?? []
  )
  const untrackedFiles = createMemo(
    () => status()?.files.filter((f) => !f.staged && f.status === '?') ?? []
  )
  const stageableFiles = createMemo(
    () => status()?.files.filter((f) => !f.staged && f.status !== 'U') ?? []
  )
  const totalChanged = createMemo(() => status()?.files.length ?? 0)
  const branchLabel = createMemo(() => {
    const current = status()
    if (!current) return ''
    return current.isDetached ? 'Detached HEAD' : current.branch || 'No branch'
  })
  const syncLabel = createMemo(() => {
    const current = status()
    if (!current) return ''
    const parts: string[] = []
    if (current.upstream) parts.push(current.upstream)
    if (current.ahead > 0) parts.push(`↑${current.ahead}`)
    if (current.behind > 0) parts.push(`↓${current.behind}`)
    return parts.join(' ')
  })
  const syncBlocked = createMemo(() => {
    const current = status()
    return (
      !current || current.operation !== 'none' || current.hasConflicts || syncingAction() !== null
    )
  })

  return (
    <aside class="git-panel" style={props.style} data-side={props.side ?? 'right'}>
      <div class={`git-panel-header${props.onDragHandleMouseDown ? ' has-drag-grip' : ''}`}>
        <Show when={props.onDragHandleMouseDown}>
          <button
            type="button"
            class="panel-drag-grip"
            title="Drag to move panel to the other side"
            aria-label="Drag panel"
            onMouseDown={props.onDragHandleMouseDown}
          >
            <GripVertical size={13} />
          </button>
        </Show>
        <div class="git-panel-tab-bar">
          <div class="git-panel-tabs">
            <button
              type="button"
              class={`git-panel-tab ${activeTab() === 'history' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('history')}
            >
              History
            </button>
            <button
              type="button"
              class={`git-panel-tab ${activeTab() === 'changes' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('changes')}
            >
              Changes
              <Show when={totalChanged() > 0}>
                <span class="git-panel-tab-count">{totalChanged()}</span>
              </Show>
            </button>
          </div>
        </div>

        <Show
          when={status()?.stashCount || status()?.operation !== 'none' || status()?.hasConflicts}
        >
          <div class="git-status-strip">
            <Show when={status()?.stashCount}>
              <span class="git-meta-chip">stash {status()?.stashCount}</span>
            </Show>
            <Show when={status()?.operation !== 'none'}>
              <span class="git-warning-chip">{status()?.operation} in progress</span>
            </Show>
            <Show when={status()?.hasConflicts}>
              <span class="git-warning-chip">conflicts</span>
            </Show>
          </div>
        </Show>
      </div>

      <Show when={activeTab() === 'changes'}>
        <div class="git-panel-body">
          <Show when={agentChangedCount() !== null}>
            <div class="git-agent-banner">
              <span>
                ✨ Agent modified {agentChangedCount()} file{agentChangedCount() !== 1 ? 's' : ''} —
                review before committing
              </span>
              <button
                type="button"
                class="git-agent-banner-dismiss"
                onClick={() => setAgentChangedCount(null)}
                title="Dismiss"
              >
                ✕
              </button>
            </div>
          </Show>
          <Show when={status()} fallback={<div class="git-panel-empty">Loading git status…</div>}>
            <Show when={totalChanged() === 0}>
              <div class="git-panel-empty">No changes to commit</div>
            </Show>

            <Show when={totalChanged() > 0}>
              <Show when={stageableFiles().length > 0}>
                <div class="git-worktree-actions">
                  <span>{stageableFiles().length} unstaged</span>
                  <button
                    type="button"
                    class="git-stage-all-btn"
                    onClick={() => void handleStageAll()}
                  >
                    Stage All
                  </button>
                </div>
              </Show>

              <Show when={conflictFiles().length > 0}>
                <section class="git-section git-section--conflicts">
                  <div class="git-section-title">
                    Conflicts
                    <span class="git-section-count">{conflictFiles().length}</span>
                  </div>
                  <For each={conflictFiles()}>
                    {(file) => (
                      <GitFileRow
                        file={file}
                        loadingDiff={loadingDiff()}
                        onFileClick={handleFileClick}
                        onStageToggle={handleStageToggle}
                      />
                    )}
                  </For>
                </section>
              </Show>

              <Show when={stagedFiles().length > 0}>
                <section class="git-section">
                  <div class="git-section-title">
                    Staged
                    <span class="git-section-count">{stagedFiles().length}</span>
                  </div>
                  <For each={stagedFiles()}>
                    {(file) => (
                      <GitFileRow
                        file={file}
                        loadingDiff={loadingDiff()}
                        onFileClick={handleFileClick}
                        onStageToggle={handleStageToggle}
                      />
                    )}
                  </For>
                </section>
              </Show>

              <Show when={unstagedFiles().length > 0}>
                <section class="git-section">
                  <div class="git-section-title">
                    Changes
                    <span class="git-section-count">{unstagedFiles().length}</span>
                  </div>
                  <For each={unstagedFiles()}>
                    {(file) => (
                      <GitFileRow
                        file={file}
                        loadingDiff={loadingDiff()}
                        onFileClick={handleFileClick}
                        onStageToggle={handleStageToggle}
                      />
                    )}
                  </For>
                </section>
              </Show>

              <Show when={untrackedFiles().length > 0}>
                <section class="git-section">
                  <div class="git-section-title">
                    Untracked
                    <span class="git-section-count">{untrackedFiles().length}</span>
                  </div>
                  <For each={untrackedFiles()}>
                    {(file) => (
                      <GitFileRow
                        file={file}
                        loadingDiff={loadingDiff()}
                        onFileClick={handleFileClick}
                        onStageToggle={handleStageToggle}
                      />
                    )}
                  </For>
                </section>
              </Show>
            </Show>
          </Show>

          <Show when={status() && stagedFiles().length > 0}>
            <div class="git-commit-area">
              <div class="git-commit-composer">
                <textarea
                  class="git-commit-input"
                  placeholder="Enter commit message"
                  value={commitMessage()}
                  onInput={(e) => setCommitMessage(e.currentTarget.value)}
                  rows={4}
                  disabled={isCommitting()}
                />
                <div class="git-commit-composer-footer">
                  <div class="git-commit-footer-left">
                    <button
                      type="button"
                      class="git-generate-msg-btn"
                      title="Generate commit message from staged diff"
                      aria-label="Generate commit message from staged diff"
                      disabled={isGeneratingMsg() || isCommitting()}
                      onClick={() => void handleGenerateCommitMessage()}
                    >
                      <Show
                        when={!isGeneratingMsg()}
                        fallback={<span class="git-generate-spinner">⋯</span>}
                      >
                        <Sparkles size={14} />
                      </Show>
                    </button>
                    {/* Sync remote — Portal-based click popover to avoid overflow clipping */}
                    <button
                      ref={(el) => {
                        syncBtnRef = el
                      }}
                      type="button"
                      class={`git-icon-btn${syncMenuOpen() ? ' is-active' : ''}`}
                      disabled={syncBlocked()}
                      title={syncingAction() ? 'Syncing…' : 'Sync remote'}
                      aria-label="Sync with remote"
                      aria-expanded={syncMenuOpen()}
                      onClick={() => {
                        const rect = syncBtnRef?.getBoundingClientRect() ?? null
                        setSyncMenuAnchor(rect)
                        setSyncMenuOpen((v) => !v)
                      }}
                    >
                      <ArrowUpDown size={14} />
                    </button>
                    <Show when={syncMenuOpen() && syncMenuAnchor()}>
                      {(anchor) => (
                        <Portal>
                          <div
                            role="presentation"
                            aria-hidden="true"
                            class="git-sync-backdrop"
                            onClick={() => setSyncMenuOpen(false)}
                          />
                          <div
                            class="git-sync-popover git-sync-popover--portal"
                            style={{
                              bottom: `${window.innerHeight - anchor().top + 4}px`,
                              left: `${anchor().left}px`,
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setSyncMenuOpen(false)
                                void handleSync('fetch')
                              }}
                              disabled={syncBlocked()}
                            >
                              Fetch
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setSyncMenuOpen(false)
                                void handleSync('pull')
                              }}
                              disabled={syncBlocked() || !status()?.upstream || totalChanged() > 0}
                            >
                              Pull
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setSyncMenuOpen(false)
                                void handleSync('pull-rebase')
                              }}
                              disabled={syncBlocked() || !status()?.upstream || totalChanged() > 0}
                            >
                              Pull (Rebase)
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setSyncMenuOpen(false)
                                void handleSync('push')
                              }}
                              disabled={syncBlocked() || !status()?.upstream}
                            >
                              Push
                            </button>
                            <button
                              type="button"
                              disabled
                              title="Force push requires protected-action confirmation"
                            >
                              Force Push
                            </button>
                          </div>
                        </Portal>
                      )}
                    </Show>
                  </div>
                  {/* end git-commit-footer-left */}
                  <div class="git-commit-mode-actions">
                    <button
                      type="button"
                      class="git-commit-mode-btn"
                      onClick={() => void handleCommit(false)}
                      disabled={isCommitting() || !commitMessage().trim()}
                    >
                      {isCommitting()
                        ? 'Committing…'
                        : commitAmend()
                          ? 'Amend Staged'
                          : 'Commit Staged'}
                    </button>
                    <button
                      type="button"
                      class={`git-commit-mode-menu-btn ${commitOptionsOpen() ? 'is-active' : ''}`}
                      disabled={isCommitting() || !commitMessage().trim()}
                      title="Commit options"
                      aria-label="Commit options"
                      aria-expanded={commitOptionsOpen()}
                      onClick={() => setCommitOptionsOpen((open) => !open)}
                    >
                      <ChevronDown size={14} />
                    </button>
                    <Show when={commitOptionsOpen()}>
                      <div class="git-commit-options-menu">
                        <button
                          type="button"
                          class="git-commit-option-row"
                          onClick={() => setCommitAmend((value) => !value)}
                        >
                          <span class="git-commit-option-check">{commitAmend() ? '✓' : ''}</span>
                          <span>
                            <strong>Amend</strong>
                          </span>
                        </button>
                        <button
                          type="button"
                          class="git-commit-option-row"
                          onClick={() => setCommitSignoff((value) => !value)}
                        >
                          <span class="git-commit-option-check">{commitSignoff() ? '✓' : ''}</span>
                          <span>
                            <strong>Signoff</strong>
                          </span>
                        </button>
                      </div>
                    </Show>
                    <button
                      type="button"
                      class="git-commit-push-btn"
                      onClick={() => void handleCommit(true)}
                      disabled={isCommitting() || !commitMessage().trim()}
                      title="Commit and push"
                      aria-label="Commit and push"
                    >
                      <ArrowUp size={14} />
                    </button>
                  </div>
                </div>
              </div>
              <Show when={commitError()}>
                <div class="git-commit-error">{commitError()}</div>
              </Show>
            </div>
          </Show>
        </div>
      </Show>

      <Show when={activeTab() === 'history'}>
        <div class="git-panel-body">
          <div class="git-history-search-row">
            <input
              class="git-refs-search"
              value={historyQuery()}
              onInput={(event) => setHistoryQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void loadHistory(event.currentTarget.value)
              }}
              placeholder="Search commits…"
            />
            <button
              type="button"
              class="git-icon-btn"
              onClick={() => void loadHistory()}
              title="Search history"
              aria-label="Search history"
            >
              <Search size={16} />
            </button>
          </div>
          <div class="git-history-container">
            <Show when={historyLoading()}>
              <div class="git-panel-empty">Loading history…</div>
            </Show>
            <Show when={historyError()}>
              <div class="git-commit-error">{historyError()}</div>
            </Show>
            <Show when={!historyLoading()}>
              <div class="git-history-list">
                <Show when={(history()?.commits.length ?? 0) === 0}>
                  <div class="git-panel-empty">No commits found</div>
                </Show>
                <For each={history()?.commits ?? []}>
                  {(commit) => (
                    <GitHistoryRow
                      commit={commit}
                      isSelected={selectedCommit()?.hash === commit.hash}
                      onSelect={setSelectedCommit}
                    />
                  )}
                </For>
              </div>
              <Show when={selectedCommit()}>
                {(commit) => <GitHistoryDetailsPane commit={commit()} />}
              </Show>
            </Show>
          </div>
        </div>
      </Show>

      <Show when={conflictPath()}>
        {(path) => (
          <ConflictResolverModal
            path={path()}
            onClose={() => setConflictPath(null)}
            onSaved={async () => {
              const nextStatus = await window.openpi.git.getStatus()
              if (nextStatus && mounted) setStatus(nextStatus)
            }}
          />
        )}
      </Show>
    </aside>
  )
}

type GitHistoryRowProps = {
  commit: GitHistoryCommit
  isSelected: boolean
  onSelect: (commit: GitHistoryCommit) => void
}

function GitHistoryRow(props: GitHistoryRowProps) {
  const formattedDate = createMemo(() => {
    const timestamp = Date.parse(props.commit.date)
    if (!Number.isFinite(timestamp)) return props.commit.date
    return new Date(timestamp).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    })
  })

  return (
    <button
      type="button"
      class={`git-history-row ${props.isSelected ? 'is-selected' : ''}`}
      onClick={() => props.onSelect(props.commit)}
    >
      <div class="git-history-graph-cell">
        <pre>{props.commit.graph}</pre>
      </div>
      <div class="git-history-message">
        <span>{props.commit.message}</span>
        <Show when={props.commit.refs}>
          <span class="git-history-refs">{props.commit.refs}</span>
        </Show>
      </div>
      <div class="git-history-meta">
        <span>{props.commit.authorName}</span>
        <span>{formattedDate()}</span>
        <span class="git-history-sha">{props.commit.shortHash}</span>
      </div>
    </button>
  )
}

type GitHistoryDetailsPaneProps = {
  commit: GitHistoryCommit
}

function parseFileStats(statsStr: string): {
  files: string[]
  added: number
  removed: number
} {
  const lines = statsStr.split('\n').filter((line) => line.trim())
  const files: string[] = []
  let added = 0
  let removed = 0

  for (const line of lines) {
    // Each line format: " filename | +N -M"
    const match = line.match(/^\s*(.+?)\s*\|\s*(\d+)?\+?(\s+)?(\d+)?-?/)
    if (match?.[1]) {
      const file = match[1].trim()
      files.push(file)
      if (match[2]) added += parseInt(match[2], 10)
      if (match[4]) removed += parseInt(match[4], 10)
    }
  }

  return { files, added, removed }
}

function GitHistoryDetailsPane(props: GitHistoryDetailsPaneProps) {
  const formattedDate = createMemo(() => {
    const timestamp = Date.parse(props.commit.date)
    if (!Number.isFinite(timestamp)) return props.commit.date
    const dt = new Date(timestamp)
    return dt.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  })

  const statsData = createMemo(() => parseFileStats(props.commit.stats))

  return (
    <div class="git-history-details-pane">
      <div class="git-history-details-header">
        <div class="git-history-details-sha">
          <span class="label">Commit</span>
          <code>{props.commit.hash}</code>
        </div>
      </div>
      <div class="git-history-details-row">
        <span class="label">Author</span>
        <span>
          {props.commit.authorName} ({props.commit.authorEmail})
        </span>
      </div>
      <div class="git-history-details-row">
        <span class="label">Date</span>
        <span>{formattedDate()}</span>
      </div>
      <Show when={props.commit.refs}>
        <div class="git-history-details-row">
          <span class="label">Refs</span>
          <span class="git-history-refs">{props.commit.refs}</span>
        </div>
      </Show>
      <div class="git-history-details-message">
        <span class="label">Message</span>
        <pre>{props.commit.message}</pre>
      </div>
      <Show when={statsData().files.length > 0}>
        <div class="git-history-details-files">
          <div class="git-history-files-header">
            <span class="label">{statsData().files.length} Changed Files</span>
            <span class="git-history-file-stats">
              <span class="git-delta-add">+{statsData().added}</span>
              <span class="git-delta-rem">-{statsData().removed}</span>
            </span>
          </div>
          <div class="git-history-files-list">
            <For each={statsData().files}>
              {(file) => (
                <div class="git-history-file-item">
                  <span class="git-history-file-name">{file}</span>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  )
}

interface GitFileRowProps {
  file: GitChangedFile
  loadingDiff: string | null
  onFileClick: (f: GitChangedFile) => void
  onStageToggle: (f: GitChangedFile, e: Event) => void
}

function GitFileRow(props: GitFileRowProps) {
  const parts = props.file.path.split('/')
  const filename = parts.pop() ?? props.file.path
  const dir = parts.join('/') || null
  const isLoading = () => props.loadingDiff === props.file.path

  return (
    <div class={`git-file-row ${isLoading() ? 'is-loading' : ''}`}>
      <button
        type="button"
        class={`git-stage-check ${props.file.staged ? 'is-staged' : ''}`}
        aria-label={props.file.staged ? `Unstage ${props.file.path}` : `Stage ${props.file.path}`}
        onClick={(e) => props.onStageToggle(props.file, e)}
        title={props.file.staged ? 'Unstage' : 'Stage'}
      >
        {props.file.staged ? '✓' : '○'}
      </button>

      <button type="button" class="git-file-open-btn" onClick={() => props.onFileClick(props.file)}>
        <span class="git-file-name">
          {filename}
          <Show when={dir}>
            <span class="git-file-dir">{dir}</span>
          </Show>
        </span>

        <span class={`git-status-badge ${STATUS_CLASS[props.file.status] ?? 'git-badge-m'}`}>
          {STATUS_LABEL[props.file.status] ?? '?'}
        </span>
        <Show when={props.file.added > 0 || props.file.removed > 0}>
          <span class="git-file-delta">
            <Show when={props.file.added > 0}>
              <span class="git-delta-add">+{props.file.added}</span>
            </Show>
            <Show when={props.file.removed > 0}>
              <span class="git-delta-rem"> -{props.file.removed}</span>
            </Show>
          </span>
        </Show>
      </button>
    </div>
  )
}
