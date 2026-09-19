/**
 * Per-file diff readers: the auto/staged/branch/working scope chain for one
 * path, and the commit diff reader. All read-only.
 */

import simpleGit from 'simple-git'
import type { GitFileDiff } from '../../src/lib/ipc'
import { countContentLines, countDiffLines } from '../../src/lib/diffCount'
import { withGitLock } from './gitLock'
import { effectiveStatus, readDiffContents, readWorkingText } from './gitInternal'

export async function getGitFileDiff(
  cwd: string,
  filePath: string,
  options: { scope?: 'unstaged' | 'staged' | 'branch' | 'auto'; baseBranch?: string } = {}
): Promise<GitFileDiff> {
  return withGitLock(cwd, async () => {
    const git = simpleGit({ baseDir: cwd })
    const scope = options.scope ?? 'auto'
    try {
      // ─── Branch scope: working tree vs base branch ──────────────────────
      if (scope === 'branch') {
        const base = options.baseBranch ?? 'main'
        const raw = await git.raw([
          'diff',
          '--no-color',
          `${base}...HEAD`,
          '--unified=3',
          '--',
          filePath,
        ])
        if (!raw.trim()) {
          return {
            path: filePath,
            rawPatch: '',
            totalAdded: 0,
            totalRemoved: 0,
            isNew: false,
            isDeleted: false,
          }
        }
        const { added, removed } = countDiffLines(raw)
        const contents = await readDiffContents(cwd, git, filePath, 'branch', base)
        return {
          path: filePath,
          rawPatch: raw,
          ...contents,
          totalAdded: added,
          totalRemoved: removed,
          isNew: added > 0 && removed === 0,
          isDeleted: removed > 0 && added === 0,
        }
      }

      // ─── Staged scope: index vs HEAD ─────────────────────────────────────
      if (scope === 'staged') {
        const raw = await git.raw(['diff', '--no-color', '--staged', '--unified=3', '--', filePath])
        if (!raw.trim()) {
          return {
            path: filePath,
            rawPatch: '',
            totalAdded: 0,
            totalRemoved: 0,
            isNew: false,
            isDeleted: false,
          }
        }
        const { added, removed } = countDiffLines(raw)
        return {
          path: filePath,
          rawPatch: raw,
          ...(await readDiffContents(cwd, git, filePath, 'index')),
          totalAdded: added,
          totalRemoved: removed,
          isNew: false,
          isDeleted: removed > 0 && added === 0,
        }
      }

      // ─── Unstaged scope: working tree vs index ───────────────────────────
      if (scope === 'unstaged') {
        const raw = await git.raw(['diff', '--no-color', '--unified=3', '--', filePath])
        if (!raw.trim()) {
          const status = await git.status().catch(() => null)
          const isUntracked =
            status?.files.some(
              (file) =>
                file.path === filePath && effectiveStatus(file.index, file.working_dir) === '?'
            ) ?? false
          const workingContent = readWorkingText(cwd, filePath)
          if (isUntracked && workingContent !== null) {
            return {
              path: filePath,
              rawPatch: '',
              oldContent: '',
              newContent: workingContent,
              totalAdded: countContentLines(workingContent),
              totalRemoved: 0,
              isNew: true,
              isDeleted: false,
            }
          }
          return {
            path: filePath,
            rawPatch: '',
            totalAdded: 0,
            totalRemoved: 0,
            isNew: false,
            isDeleted: false,
          }
        }
        const { added, removed } = countDiffLines(raw)
        return {
          path: filePath,
          rawPatch: raw,
          ...(await readDiffContents(cwd, git, filePath, 'working')),
          totalAdded: added,
          totalRemoved: removed,
          isNew: added > 0 && removed === 0,
          isDeleted: removed > 0 && added === 0,
        }
      }

      // ─── Auto scope: fallback chain (unstaged → staged → untracked) ──────
      const raw = await git.raw(['diff', '--no-color', '--unified=3', '--', filePath])
      if (!raw.trim()) {
        const stagedRaw = await git.raw([
          'diff',
          '--no-color',
          '--staged',
          '--unified=3',
          '--',
          filePath,
        ])
        if (!stagedRaw.trim()) {
          const status = await git.status().catch(() => null)
          const isUntracked =
            status?.files.some(
              (file) =>
                file.path === filePath && effectiveStatus(file.index, file.working_dir) === '?'
            ) ?? false
          const workingContent = readWorkingText(cwd, filePath)
          if (isUntracked && workingContent !== null) {
            return {
              path: filePath,
              rawPatch: '',
              oldContent: '',
              newContent: workingContent,
              totalAdded: countContentLines(workingContent),
              totalRemoved: 0,
              isNew: true,
              isDeleted: false,
            }
          }
          return {
            path: filePath,
            rawPatch: '',
            totalAdded: 0,
            totalRemoved: 0,
            isNew: false,
            isDeleted: false,
          }
        }
        const { added, removed } = countDiffLines(stagedRaw)
        return {
          path: filePath,
          rawPatch: stagedRaw,
          ...(await readDiffContents(cwd, git, filePath, 'index')),
          totalAdded: added,
          totalRemoved: removed,
          isNew: false,
          isDeleted: removed > 0 && added === 0,
        }
      }
      const { added, removed } = countDiffLines(raw)
      return {
        path: filePath,
        rawPatch: raw,
        ...(await readDiffContents(cwd, git, filePath, 'working')),
        totalAdded: added,
        totalRemoved: removed,
        isNew: added > 0 && removed === 0,
        isDeleted: removed > 0 && added === 0,
      }
    } catch {
      return {
        path: filePath,
        rawPatch: '',
        totalAdded: 0,
        totalRemoved: 0,
        isNew: false,
        isDeleted: false,
      }
    }
  })
}

export async function getGitCommitDiff(
  cwd: string,
  hash: string,
  filePath?: string
): Promise<GitFileDiff> {
  const git = simpleGit({ baseDir: cwd })
  try {
    const args = ['diff-tree', '--no-commit-id', '-r', '-p', hash, '--unified=3']
    if (filePath) args.push('--', filePath)
    const raw = await git.raw(args)
    const { added, removed } = countDiffLines(raw)
    return {
      path: filePath ?? hash,
      rawPatch: raw,
      totalAdded: added,
      totalRemoved: removed,
      isNew: false,
      isDeleted: false,
    }
  } catch {
    return {
      path: filePath ?? hash,
      rawPatch: '',
      totalAdded: 0,
      totalRemoved: 0,
      isNew: false,
      isDeleted: false,
    }
  }
}
