import { createEffect, createMemo, createSignal } from 'solid-js'
import type { GitPanelTab } from '../components/git/gitPanelTypes'
import type { GitGraphColumn, GitHistoryCommit, GitHistoryResult } from '../lib/ipc'

interface UseGitHistoryStateConfig {
  activeTab: () => GitPanelTab
  cwd: () => string | null
  isMounted: () => boolean
}

export function useGitHistoryState(config: UseGitHistoryStateConfig) {
  const [history, setHistory] = createSignal<GitHistoryResult | null>(null)
  const [historyQuery, setHistoryQuery] = createSignal('')
  const [historyLoading, setHistoryLoading] = createSignal(false)
  const [historyError, setHistoryError] = createSignal<string | null>(null)
  const [selectedCommit, setSelectedCommit] = createSignal<GitHistoryCommit | null>(null)

  const loadHistory = async (query = historyQuery()) => {
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      const result = await window.openpi.git.getHistory(query, 100)
      if (config.isMounted() && result) setHistory(result)
    } catch (err) {
      if (config.isMounted()) setHistoryError(String(err))
    } finally {
      if (config.isMounted()) setHistoryLoading(false)
    }
  }

  createEffect(() => {
    if (config.activeTab() === 'history' && config.cwd()) void loadHistory()
  })

  const graphColumnsByHash = createMemo(() => {
    const rows = history()?.graphRows ?? []
    const map = new Map<string, GitGraphColumn[]>()
    for (const row of rows) {
      if (row.commitHash) {
        map.set(row.commitHash, row.columns)
      }
    }
    return map
  })

  const maxGraphColumns = createMemo(() => {
    const rows = history()?.graphRows ?? []
    let max = 0
    for (const row of rows) {
      for (const col of row.columns) {
        if (col.col >= max) max = col.col + 1
      }
    }
    return Math.max(max, 1)
  })

  return {
    history,
    historyQuery,
    historyLoading,
    historyError,
    selectedCommit,
    setHistoryQuery,
    setSelectedCommit,
    loadHistory,
    graphColumnsByHash,
    maxGraphColumns,
  }
}
