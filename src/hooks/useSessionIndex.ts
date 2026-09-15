import { batch, createSignal } from 'solid-js'
import type { SessionListItem, SessionListOptions, WorkspaceInfo } from '../lib/ipc'
import type { GroupMode, SortMode } from '../types/session'

const RECENT_DAYS = 30
const WORKSPACE_PREVIEW_LIMIT = 8

export function useSessionIndex(getFallbackWorkspacePath: () => string | null) {
  const [workspaces, setWorkspaces] = createSignal<WorkspaceInfo[]>([])
  const [sessions, setSessions] = createSignal<SessionListItem[]>([])
  const [selectedWorkspacePath, setSelectedWorkspacePath] = createSignal<string | null>(null)
  const [sessionQuery, setSessionQuery] = createSignal('')
  const [sortBy, setSortBy] = createSignal<SortMode>('created')
  const [groupBy, setGroupBy] = createSignal<GroupMode>('workspace')
  const [showRecent, setShowRecent] = createSignal(true)

  const selectedWorkspaceForQuery = () => selectedWorkspacePath() ?? getFallbackWorkspacePath()

  const loadSessionIndex = async (workspaceOverride?: string | null) => {
    const workspacePath = workspaceOverride ?? selectedWorkspaceForQuery()
    const options: SessionListOptions = {
      query: sessionQuery(),
      sortBy: sortBy(),
      groupBy: groupBy(),
      showRecent: showRecent(),
      recentDays: RECENT_DAYS,
      workspacePath: workspacePath ?? undefined,
    }
    const [workspaceList, sessionList] = await Promise.all([
      window.openpi.getWorkspaces(),
      window.openpi.getSessions(options),
    ])
    batch(() => {
      setWorkspaces(workspaceList)
      setSessions(sessionList)
      if (!selectedWorkspacePath()) {
        const fallback = workspacePath ?? workspaceList[0]?.path ?? null
        if (fallback) setSelectedWorkspacePath(fallback)
      }
    })
  }

  const selectWorkspace = async (workspacePath: string) => {
    setSelectedWorkspacePath(workspacePath)
    await loadSessionIndex(workspacePath)
  }

  const loadWorkspacePreview = (workspacePath: string): Promise<SessionListItem[]> => {
    return window.openpi.getSessions({
      workspacePath,
      sortBy: 'updated',
      showRecent: false,
      limit: WORKSPACE_PREVIEW_LIMIT,
    })
  }

  return {
    workspaces,
    sessions,
    selectedWorkspacePath,
    sessionQuery,
    sortBy,
    groupBy,
    showRecent,
    setSelectedWorkspacePath,
    setSessionQuery,
    setSortBy,
    setGroupBy,
    setShowRecent,
    selectedWorkspaceForQuery,
    loadSessionIndex,
    selectWorkspace,
    loadWorkspacePreview,
  }
}
