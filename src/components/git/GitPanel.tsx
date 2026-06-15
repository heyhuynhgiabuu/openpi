import { createEffect, createSignal, onMount, Show } from 'solid-js'
import { useGitPanelDerived } from '../../hooks/useGitPanelDerived'
import type { GitChangedFile, GitStatusResult, GitSyncAction } from '../../lib/ipc'
import { GitChangesTab } from './GitChangesTab'
import { GitConflictModal } from './GitConflictModal'
import { GitPanelHeader } from './GitPanelHeader'
import type { GitPanelProps, GitPanelTab } from './gitPanelTypes'

export function GitPanel(props: GitPanelProps) {
  const [status, setStatus] = createSignal<GitStatusResult | null>(null)
  const [commitMessage, setCommitMessage] = createSignal('')
  const [isCommitting, setIsCommitting] = createSignal(false)
  const [isGeneratingMsg, setIsGeneratingMsg] = createSignal(false)
  const [agentChangedFiles, setAgentChangedFiles] = createSignal<{
    count: number
    files: GitChangedFile[]
  } | null>(null)
  const [showingAgentChanges, setShowingAgentChanges] = createSignal(false)
  const [commitOptionsOpen, setCommitOptionsOpen] = createSignal(false)
  const [commitAmend, setCommitAmend] = createSignal(false)
  const [commitSignoff, setCommitSignoff] = createSignal(false)
  const [syncingAction, setSyncingAction] = createSignal<GitSyncAction | null>(null)
  const derived = useGitPanelDerived({
    status,
    agentChangedFiles,
    showingAgentChanges,
    syncingAction,
  })
  const [commitError, setCommitError] = createSignal<string | null>(null)
  const [syncMessage, setSyncMessage] = createSignal<string | null>(null)
  const [loadingDiff, setLoadingDiff] = createSignal<string | null>(null)
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
    const unsub = window.openpi.git.onAgentChangedFiles((payload) => {
      setAgentChangedFiles(payload)
      setShowingAgentChanges(false)
    })
    return unsub
  })

  // Surface branch + upstream labels up to the parent (→ TopBar via App).
  createEffect(() => {
    props.onBranchLabelChange?.(derived.branchLabel())
  })
  createEffect(() => {
    props.onSyncLabelChange?.(derived.syncLabel())
  })
  // Surface sync action + message to the parent shell.
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

  const handleUnstageAll = async () => {
    const current = status()
    if (!current) return

    const staged = current.files.filter((f) => f.staged)
    for (const file of staged) {
      await window.openpi.git.unstage(file.path)
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
    if ((action === 'pull' || action === 'pull-rebase') && derived.totalChanged() > 0) {
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

  return (
    <aside class="git-panel" style={props.style} data-side={props.side ?? 'right'}>
      <Show when={!props.hideHeader}>
        <GitPanelHeader
          activeTab={activeTab()}
          totalChanged={derived.totalChanged()}
          status={status()}
          onActiveTabChange={setActiveTab}
          onDragHandleMouseDown={props.onDragHandleMouseDown}
        />
      </Show>

      <Show when={activeTab() === 'changes'}>
        <GitChangesTab
          agentChangedFiles={agentChangedFiles()}
          showingAgentFiles={derived.showingAgentFiles()}
          statusLoaded={Boolean(status())}
          hasUpstream={Boolean(status()?.upstream)}
          totalChanged={derived.totalChanged()}
          stageableFiles={derived.stageableFiles()}
          pinnedAgentFiles={derived.pinnedAgentFiles()}
          conflictFiles={derived.conflictFiles()}
          stagedFiles={derived.stagedFiles()}
          unstagedFiles={derived.unstagedFiles()}
          untrackedFiles={derived.untrackedFiles()}
          loadingDiff={loadingDiff()}
          commitMessage={commitMessage()}
          isCommitting={isCommitting()}
          isGeneratingMessage={isGeneratingMsg()}
          commitOptionsOpen={commitOptionsOpen()}
          commitAmend={commitAmend()}
          commitSignoff={commitSignoff()}
          commitError={commitError()}
          syncingAction={syncingAction()}
          syncBlocked={derived.syncBlocked()}
          onReviewAgentChanges={() => setShowingAgentChanges((prev) => !prev)}
          onDismissAgentChanges={() => {
            setAgentChangedFiles(null)
            setShowingAgentChanges(false)
          }}
          onStageAll={() => void handleStageAll()}
          onUnstageAll={() => void handleUnstageAll()}
          onShowAllChanges={() => setShowingAgentChanges(false)}
          onFileClick={handleFileClick}
          onStageToggle={handleStageToggle}
          onCommitMessageChange={setCommitMessage}
          onGenerateCommitMessage={() => void handleGenerateCommitMessage()}
          onCommit={(push) => void handleCommit(push)}
          onCommitOptionsOpenChange={setCommitOptionsOpen}
          onCommitAmendChange={setCommitAmend}
          onCommitSignoffChange={setCommitSignoff}
          onSync={(action) => void handleSync(action)}
          onOpenHistory={props.onOpenHistory}
        />
      </Show>

      <GitConflictModal
        path={conflictPath()}
        onClose={() => setConflictPath(null)}
        onSaved={async () => {
          const nextStatus = await window.openpi.git.getStatus()
          if (nextStatus && mounted) setStatus(nextStatus)
        }}
      />
    </aside>
  )
}
