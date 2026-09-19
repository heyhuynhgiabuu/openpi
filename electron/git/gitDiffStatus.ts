/**
 * gitDiffStatus.ts — Git status, workspace summary, and remote URL, plus the
 * re-export surface for the diff readers that used to live here. Consumers
 * (gitHost, git IPC, tests) import from this module.
 *
 * Split for the 300-LOC cap:
 *   gitInternal.ts    — status codes, git-dir detection, content readers
 *   gitFileDiff.ts    — per-file scope chain + commit diff
 *   gitScopedDiffs.ts — staged/branch-range diffs and base detection
 *
 * All read-only operations.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import simpleGit from 'simple-git'
import type { GitChangedFile, GitStatusResult, WorkspaceSummaryInfo } from '../../src/lib/ipc'
import { withGitLock } from './gitLock'
import { detectGitOperation, effectiveStatus } from './gitInternal'

export { effectiveStatus, resolveGitDir } from './gitInternal'
export { getGitFileDiff, getGitCommitDiff } from './gitFileDiff'
export { getGitStagedDiff, getGitBranchDiff, getGitBranchBase } from './gitScopedDiffs'

export function timestampFromDate(value: string | Date | null | undefined): number | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.getTime()
}

function statMtimeMs(fullPath: string): number | null {
  try {
    return fs.statSync(fullPath).mtimeMs
  } catch {
    return null
  }
}

export async function getWorkspaceSummary(cwd: string): Promise<WorkspaceSummaryInfo> {
  const git = simpleGit({ baseDir: cwd })
  const [branchResult, logResult, statusResult] = await Promise.all([
    git.branch().catch(() => null),
    git.log({ maxCount: 1 }).catch(() => null),
    git.status().catch(() => null),
  ])

  const commitTimestamp = timestampFromDate(logResult?.latest?.date ?? null)
  const fileTimestamps: number[] = []
  for (const file of statusResult?.files ?? []) {
    const ts = statMtimeMs(path.join(cwd, file.path))
    if (ts != null) fileTimestamps.push(ts)
  }
  fileTimestamps.sort((a, b) => b - a)

  const timestamps = [commitTimestamp, ...fileTimestamps].filter((t): t is number => t !== null)
  const lastModifiedAt =
    timestamps.length > 0 ? new Date(Math.max(...timestamps)).toISOString() : null

  return {
    cwd,
    displayName: path.basename(cwd) || cwd,
    branch: branchResult?.current ?? null,
    lastModifiedAt,
  }
}

export async function getGitStatus(cwd: string): Promise<GitStatusResult> {
  return withGitLock(cwd, async () => {
    const git = simpleGit({ baseDir: cwd })
    const [status, unstagedSummary, stagedSummary, operation, stashList] = await Promise.all([
      git.status(),
      git.diffSummary(['--no-color']).catch(() => null),
      git.diffSummary(['--staged', '--no-color']).catch(() => null),
      detectGitOperation(cwd),
      git.stashList().catch(() => ({ total: 0 })),
    ])

    const unstagedMap = new Map<string, { added: number; removed: number }>()
    for (const f of unstagedSummary?.files ?? []) {
      if (!f.binary) {
        unstagedMap.set(f.file, {
          added: (f as { insertions: number }).insertions ?? 0,
          removed: (f as { deletions: number }).deletions ?? 0,
        })
      }
    }

    const stagedMap = new Map<string, { added: number; removed: number }>()
    for (const f of stagedSummary?.files ?? []) {
      if (!f.binary) {
        stagedMap.set(f.file, {
          added: (f as { insertions: number }).insertions ?? 0,
          removed: (f as { deletions: number }).deletions ?? 0,
        })
      }
    }

    const files: GitChangedFile[] = status.files.map((f) => {
      const isStaged = f.index !== ' ' && f.index !== '?' && f.index !== ''
      const stagedStats = stagedMap.get(f.path) ?? { added: 0, removed: 0 }
      const unstagedStats = unstagedMap.get(f.path) ?? { added: 0, removed: 0 }
      const stats = isStaged
        ? {
            added: stagedStats.added + unstagedStats.added,
            removed: stagedStats.removed + unstagedStats.removed,
          }
        : unstagedStats
      return {
        path: f.path,
        status: effectiveStatus(f.index, f.working_dir),
        staged: isStaged,
        added: stats.added,
        removed: stats.removed,
      }
    })

    const totalAdded = files.reduce((s, f) => s + f.added, 0)
    const totalRemoved = files.reduce((s, f) => s + f.removed, 0)

    return {
      branch: status.current ?? (status.detached ? 'HEAD' : ''),
      upstream: status.tracking ?? null,
      ahead: status.ahead ?? 0,
      behind: status.behind ?? 0,
      isDetached: status.detached,
      hasConflicts: status.conflicted.length > 0 || files.some((f) => f.status === 'U'),
      operation,
      stashCount: stashList.total,
      totalAdded,
      totalRemoved,
      files,
    }
  })
}

export async function getGitRemoteUrl(cwd: string): Promise<string | null> {
  const git = simpleGit({ baseDir: cwd })
  const remotes = await git.getRemotes(true)
  return remotes[0]?.refs?.fetch ?? null
}
