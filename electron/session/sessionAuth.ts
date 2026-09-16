/**
 * sessionAuth.ts — path authorization for session IPC handlers.
 *
 * Structural deps so ipc.ts, inspectionIpc.ts, and sessionOpsIpc.ts share one
 * implementation. Deny-only: every failure throws; no caller may turn an
 * authorization error into an allowance.
 */
import path from 'node:path'
import type { SessionState } from './sessionHost'
import type { SessionIndexStore } from './sessionIndex'
import { resolveAuthorizedFile } from './sessionPath'

export interface SessionAuthDeps {
  getAgentDir: () => string
  getSessionState: () => SessionState | null
  getSessionIndex: () => SessionIndexStore | null
  activeWorkspacePath: () => string | null
}

export function authorizedWorkspacePath(deps: SessionAuthDeps, submittedCwd: string): string {
  const candidate = path.resolve(submittedCwd)
  const active = deps.activeWorkspacePath()
  if (active && path.resolve(active) === candidate) return active
  const known = deps
    .getSessionIndex()
    ?.listWorkspaces()
    .find((workspace) => path.resolve(workspace.path) === candidate)
  if (known) return known.path
  throw new Error('Unknown workspace')
}

export function authorizedSessionPath(deps: SessionAuthDeps, submittedPath: string): string {
  const workspaceRoots = [deps.getSessionState()?.cwd, deps.activeWorkspacePath()]
    .filter((root): root is string => typeof root === 'string')
    .map((root) => ({ anchor: root, root: path.join(root, '.pi', 'artifacts') }))
  const agentDir = deps.getAgentDir()
  return resolveAuthorizedFile(
    submittedPath,
    [{ anchor: agentDir, root: path.join(agentDir, 'sessions') }, ...workspaceRoots],
    ['.jsonl']
  )
}

/**
 * Like authorizedSessionPath, but returns null while Pi has not flushed the
 * session's JSONL yet: the file appears only when the first assistant message
 * is appended, so a brand-new session has a valid path with no file. Every
 * other authorization failure still throws.
 */
export function authorizedSessionPathIfPresent(
  deps: SessionAuthDeps,
  submittedPath: string
): string | null {
  try {
    return authorizedSessionPath(deps, submittedPath)
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return null
    }
    throw error
  }
}
