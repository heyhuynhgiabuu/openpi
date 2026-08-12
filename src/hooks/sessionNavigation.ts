import type { SessionListItem, SessionReady } from '../lib/ipc'

export interface ParentStackEntry {
  path: string
  name: string | null
  cwd: string
}

interface SessionIndexNavigation {
  loadSessionIndex: () => Promise<void>
  selectedWorkspaceForQuery: () => string | null
}

interface SessionNavigationDeps {
  api: Pick<
    Window['openpi'],
    'pickWorkspace' | 'openSession' | 'resolveSubSessionPath' | 'newSession'
  >
  getReady: () => SessionReady | null
  getParentStack: () => ParentStackEntry[]
  setParentStack: (entries: ParentStackEntry[]) => void
  setError: (error: string | null) => void
  sessionIndex: SessionIndexNavigation
}

export function createSessionNavigation(deps: SessionNavigationDeps) {
  const openWorkspace = async () => {
    deps.setError(null)
    await deps.api.pickWorkspace()
    await deps.sessionIndex.loadSessionIndex()
  }

  const openExistingSession = async (session: SessionListItem) => {
    const previousStack = deps.getParentStack()
    deps.setError(null)
    deps.setParentStack([])
    try {
      await deps.api.openSession({ path: session.path })
    } catch (error) {
      deps.setParentStack(previousStack)
      throw error
    }
  }

  const openSubSession = async (taskId: string | null): Promise<boolean> => {
    const current = deps.getReady()
    const cwd = current?.cwd
    if (!cwd || !taskId) return false
    const sessionPath = await deps.api.resolveSubSessionPath({ cwd, taskId })
    if (!sessionPath) return false
    const stack = deps.getParentStack()
    const currentPath = current.sessionFile
    const nextStack =
      currentPath && (stack.length === 0 || stack[stack.length - 1]?.path !== currentPath)
        ? [...stack, { path: currentPath, name: current.sessionName ?? null, cwd }]
        : stack
    deps.setParentStack(nextStack)
    deps.setError(null)
    try {
      await deps.api.openSession({ path: sessionPath })
      return true
    } catch (error) {
      deps.setParentStack(stack)
      throw error
    }
  }

  const popToParent = async (): Promise<void> => {
    const stack = deps.getParentStack()
    const target = stack[stack.length - 1]
    if (!target) return
    deps.setParentStack(stack.slice(0, -1))
    deps.setError(null)
    try {
      await deps.api.openSession({ path: target.path })
    } catch (error) {
      deps.setParentStack(stack)
      throw error
    }
  }

  const createNewSession = async (mode?: 'local' | 'worktree', baseBranch?: string) => {
    deps.setError(null)
    const cwd = deps.sessionIndex.selectedWorkspaceForQuery() ?? deps.getReady()?.cwd
    if (!cwd) return
    await deps.api.newSession(cwd, mode, baseBranch)
  }

  return { openWorkspace, openExistingSession, openSubSession, popToParent, createNewSession }
}
