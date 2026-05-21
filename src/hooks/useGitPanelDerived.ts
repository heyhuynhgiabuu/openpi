import { createMemo } from 'solid-js'
import type { GitStatusResult, GitSyncAction } from '../../lib/ipc'

export function useGitPanelDerived(config: {
  status: () => GitStatusResult | null
  agentChangedFiles: () => { files: { path: string }[] } | null
  showingAgentChanges: () => boolean
  syncingAction: () => GitSyncAction | null
}) {
  const { status, agentChangedFiles, showingAgentChanges, syncingAction } = config

  const agentFilePaths = createMemo(
    () => new Set(agentChangedFiles()?.files.map((f) => f.path) ?? [])
  )

  const pinnedAgentFiles = createMemo(
    () => status()?.files.filter((f) => agentFilePaths().has(f.path)) ?? []
  )

  const showingAgentFiles = createMemo(
    () => showingAgentChanges() && agentChangedFiles() !== null && pinnedAgentFiles().length > 0
  )

  const conflictFiles = createMemo(() => status()?.files.filter((f) => f.status === 'U') ?? [])
  const stagedFiles = createMemo(
    () =>
      (showingAgentFiles() ? pinnedAgentFiles() : status()?.files)?.filter(
        (f) => f.staged && f.status !== 'U'
      ) ?? []
  )
  const unstagedFiles = createMemo(
    () =>
      (showingAgentFiles() ? pinnedAgentFiles() : status()?.files)?.filter(
        (f) => !f.staged && f.status !== '?' && f.status !== 'U'
      ) ?? []
  )
  const untrackedFiles = createMemo(
    () => status()?.files.filter((f) => !f.staged && f.status === '?') ?? []
  )
  const stageableFiles = createMemo(
    () =>
      (showingAgentFiles() ? pinnedAgentFiles() : status()?.files)?.filter(
        (f) => !f.staged && f.status !== 'U'
      ) ?? []
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

  return {
    agentFilePaths,
    pinnedAgentFiles,
    showingAgentFiles,
    conflictFiles,
    stagedFiles,
    unstagedFiles,
    untrackedFiles,
    stageableFiles,
    totalChanged,
    branchLabel,
    syncLabel,
    syncBlocked,
  }
}
