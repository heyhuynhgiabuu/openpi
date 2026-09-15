/**
 * gitHost.ts — Git authority for OpenPi.
 *
 * Re-exports from domain-specific modules so consumers import from a single module.
 * Also owns polling logic (startGitPoll / stopGitPoll) and checkoutBranch
 * (which depends on getGitStatus feedback).
 *
 * Uses simple-git. NEVER uses `git add .` or `git add -A`; always passes
 * explicit file paths.
 */

import simpleGit from 'simple-git'
import type { GitCheckoutBranchResult, GitStatusResult } from '../../src/lib/ipc'
import { getGitStatus } from './gitDiffStatus'
import { withGitLock } from './gitLock'

// ─── Re-exports — consumers import from gitHost.ts ─────────────────────────

export { generateCommitMessage } from './gitCommitMessage'
// Read operations
export {
  getGitBranchBase,
  getGitBranchDiff,
  getGitCommitDiff,
  getGitFileDiff,
  getGitRemoteUrl,
  getGitStagedDiff,
  getGitStatus,
  getWorkspaceSummary,
} from './gitDiffStatus'
export { getFileTree, startFileTreeWatch, stopFileTreeWatch } from './gitFileTree'
export { getGitHistory, getGitRefs } from './gitHistory'
export type { HunkActionResult } from './gitMutations'
export {
  commitFiles,
  createBranch,
  discardFile,
  revertHunk,
  stageFile,
  stageHunk,
  stashApply,
  stashDrop,
  stashPop,
  syncRemote,
  unstageFile,
  unstageHunk,
} from './gitMutations'

// ─── Polling watcher ────────────────────────────────────────────────────────

let pollTimer: ReturnType<typeof setTimeout> | null = null

export function startGitPoll(cwd: string, onChange: (status: GitStatusResult) => void): void {
  stopGitPoll()
  const poll = async (): Promise<void> => {
    try {
      onChange(await getGitStatus(cwd))
    } catch {
      // ignore poll errors
    }
  }
  void poll()
  pollTimer = setInterval(poll, 3000)
}

export function stopGitPoll(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

// ─── Checkout branch ───────────────────────────────────────────────────────

export async function checkoutBranch(
  cwd: string,
  branch: string
): Promise<GitCheckoutBranchResult> {
  return withGitLock(cwd, async () => {
    const git = simpleGit({ baseDir: cwd })
    // Check for dirty worktree directly — do NOT call getGitStatus()
    // because that function also acquires withGitLock and would deadlock.
    const status = await git.status()
    if (status.files.length > 0) {
      return {
        ok: false,
        branch,
        output: 'Commit, stash, or discard local changes before switching branches.',
      }
    }

    try {
      await git.checkout(branch)
      return { ok: true, branch, output: `Switched to ${branch}.` }
    } catch (error) {
      return {
        ok: false,
        branch,
        output: error instanceof Error ? error.message : String(error),
      }
    }
  })
}
