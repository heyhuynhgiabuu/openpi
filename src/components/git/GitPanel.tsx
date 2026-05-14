/**
 * GitPanel — persistent right-side source control panel.
 *
 * Authority boundary: renderer collects intent only.
 * ALL git mutations go through window.openpi.git.* → Electron main.
 */

import { ChevronsUp, Search } from 'lucide-solid'
import { createEffect, createMemo, createSignal, For, onMount, Show } from 'solid-js'
import type { GitChangedFile, GitFileDiff, GitStatusResult } from '../../lib/ipc'
import { FileTree } from './FileTree'

interface GitPanelProps {
  style?: string | Record<string, string>
  cwd: string | null
  activeTab?: 'changes' | 'files'
  onActiveTabChange?: (tab: 'changes' | 'files') => void
  onRequestFileSearch?: () => void
  onDiffOpen: (diff: GitFileDiff, files: GitChangedFile[], index: number) => void
  onFileClick?: (relPath: string) => void
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
  const [commitError, setCommitError] = createSignal<string | null>(null)
  const [loadingDiff, setLoadingDiff] = createSignal<string | null>(null)
  const [localActiveTab, setLocalActiveTab] = createSignal<'changes' | 'files'>('changes')
  const [collapseAllCount, setCollapseAllCount] = createSignal(0)
  let mounted = true

  const activeTab = () => props.activeTab ?? localActiveTab()
  const setActiveTab = (tab: 'changes' | 'files') => {
    props.onActiveTabChange?.(tab)
    setLocalActiveTab(tab)
  }

  onMount(() => {
    window.openpi.notifyGitPanelMounted()
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

  const handleFileClick = async (file: GitChangedFile) => {
    const current = status()
    if (!current) return

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

    const unstaged = current.files.filter((f) => !f.staged)
    for (const file of unstaged) {
      await window.openpi.git.stage(file.path)
    }
    const nextStatus = await window.openpi.git.getStatus()
    if (nextStatus && mounted) setStatus(nextStatus)
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
      await window.openpi.git.commit(staged, message, push)
      if (mounted) {
        setCommitMessage('')
        const nextStatus = await window.openpi.git.getStatus()
        if (nextStatus) setStatus(nextStatus)
      }
    } catch (err) {
      if (mounted) setCommitError(String(err))
    } finally {
      if (mounted) setIsCommitting(false)
    }
  }

  const stagedFiles = createMemo(() => status()?.files.filter((f) => f.staged) ?? [])
  const unstagedFiles = createMemo(
    () => status()?.files.filter((f) => !f.staged && f.status !== '?') ?? []
  )
  const untrackedFiles = createMemo(
    () => status()?.files.filter((f) => !f.staged && f.status === '?') ?? []
  )
  const stageableFiles = createMemo(() => status()?.files.filter((f) => !f.staged) ?? [])
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

  return (
    <aside class="git-panel" style={props.style}>
      <div class="git-panel-header">
        <div class="git-panel-tab-bar">
          <div class="git-panel-tabs">
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
            <button
              type="button"
              class={`git-panel-tab ${activeTab() === 'files' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('files')}
            >
              Files
            </button>
          </div>

          <Show when={activeTab() === 'files'}>
            <div class="git-panel-actions">
              <button
                type="button"
                class="git-panel-action-btn"
                title="Search files (Shift+⌘F)"
                onClick={() => props.onRequestFileSearch?.()}
              >
                <Search size={14} />
              </button>
              <button
                type="button"
                class="git-panel-action-btn"
                title="Collapse all folders"
                onClick={() => setCollapseAllCount((n) => n + 1)}
              >
                <ChevronsUp size={14} />
              </button>
            </div>
          </Show>
        </div>

        <Show when={status()}>
          <div class="git-status-strip">
            <span class="git-branch-chip">{branchLabel()}</span>
            <Show when={syncLabel()}>
              <span class="git-upstream-chip">{syncLabel()}</span>
            </Show>
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
              <textarea
                class="git-commit-input"
                placeholder="Commit message…"
                value={commitMessage()}
                onInput={(e) => setCommitMessage(e.currentTarget.value)}
                rows={3}
                disabled={isCommitting()}
              />
              <Show when={commitError()}>
                <div class="git-commit-error">{commitError()}</div>
              </Show>
              <div class="git-commit-actions">
                <button
                  type="button"
                  class="git-commit-btn"
                  onClick={() => void handleCommit(false)}
                  disabled={isCommitting() || !commitMessage().trim()}
                >
                  {isCommitting() ? '…' : 'Commit'}
                </button>
                <button
                  type="button"
                  class="git-commit-push-btn"
                  onClick={() => void handleCommit(true)}
                  disabled={isCommitting() || !commitMessage().trim()}
                  title="Commit and push"
                >
                  ↑
                </button>
              </div>
            </div>
          </Show>
        </div>
      </Show>

      <Show when={activeTab() === 'files'}>
        <div class="git-panel-body">
          <FileTree
            cwd={props.cwd}
            changedPaths={new Set(status()?.files.map((f) => f.path))}
            onFileClick={props.onFileClick}
            triggerCollapseAll={collapseAllCount()}
          />
        </div>
      </Show>
    </aside>
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
