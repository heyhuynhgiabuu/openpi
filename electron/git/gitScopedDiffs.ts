/**
 * Range-scoped diff readers: everything staged, a whole branch against its
 * base, and base-branch detection. All read-only.
 */

import simpleGit from 'simple-git'
import type { GitFileDiff } from '../../src/lib/ipc'
import { countDiffLines } from '../../src/lib/diffCount'
import { withGitLock } from './gitLock'

/**
 * Get the diff of all staged files (`git diff --staged`).
 * Returns a record keyed by file path, or null if none.
 */
export async function getGitStagedDiff(cwd: string): Promise<Record<string, GitFileDiff> | null> {
  return withGitLock(cwd, async () => {
    const git = simpleGit({ baseDir: cwd })
    try {
      const status = await git.status()
      const stagedFiles = status.staged
      if (!stagedFiles.length) return null

      const result: Record<string, GitFileDiff> = {}
      for (const f of stagedFiles) {
        const raw = await git.raw(['diff', '--no-color', '--staged', '--unified=3', '--', f])
        const { added, removed } = countDiffLines(raw)
        result[f] = {
          path: f,
          rawPatch: raw,
          totalAdded: added,
          totalRemoved: removed,
          isNew: added > 0 && removed === 0,
          isDeleted: removed > 0 && added === 0,
        }
      }
      return result
    } catch {
      return null
    }
  })
}

/**
 * Get diff between the current branch and a base branch.
 * Returns a record keyed by file path, or null on error.
 */
export async function getGitBranchDiff(
  cwd: string,
  baseBranch?: string
): Promise<Record<string, GitFileDiff> | null> {
  return withGitLock(cwd, async () => {
    const effectiveBase = baseBranch ?? 'main'
    const git = simpleGit({ baseDir: cwd })
    try {
      const summary = await git.diffSummary(['--no-color', `${effectiveBase}...HEAD`])
      if (!summary.files.length) return null

      const result: Record<string, GitFileDiff> = {}
      for (const f of summary.files) {
        const filePath = f.file
        const raw = await git.raw([
          'diff',
          '--no-color',
          `${effectiveBase}...HEAD`,
          '--unified=3',
          '--',
          filePath,
        ])
        const { added, removed } = countDiffLines(raw)
        result[filePath] = {
          path: filePath,
          rawPatch: raw,
          totalAdded: added,
          totalRemoved: removed,
          isNew: added > 0 && removed === 0,
          isDeleted: removed > 0 && added === 0,
        }
      }
      return result
    } catch {
      return null
    }
  })
}

/**
 * Auto-detect the base branch (main/master) for the current repo.
 */
export async function getGitBranchBase(cwd: string): Promise<string | null> {
  return withGitLock(cwd, async () => {
    const git = simpleGit({ baseDir: cwd })
    try {
      const branches = ['main', 'master', 'develop']
      for (const b of branches) {
        const exists = await git.raw(['rev-parse', '--verify', b]).catch(() => null)
        if (exists?.trim()) return b
      }
      // Fallback: use the upstream tracking branch
      const status = await git.status()
      if (status.tracking) {
        const match = status.tracking.match(/^[^/]+\/(.+)$/)
        if (match) return match[1]
      }
      return null
    } catch {
      return null
    }
  })
}
