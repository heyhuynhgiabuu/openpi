/**
 * gitDiffStatus.ts — Git status, file diff, commit diff, and remote URL.
 *
 * Extracted from gitHost.ts. All read-only operations.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import simpleGit from 'simple-git'
import type {
  GitChangedFile,
  GitFileDiff,
  GitOperation,
  GitStatusResult,
  WorkspaceSummaryInfo,
} from '../../src/lib/ipc'
import { withGitLock } from './gitLock'

// ─── Internal helpers ──────────────────────────────────────────────────────
// The pure ones are exported so the status codes, line counting and ref
// resolution can be tested without a repository.

export function effectiveStatus(index: string, workingDir: string): GitChangedFile['status'] {
  if (index === 'U' || workingDir === 'U') return 'U'
  // Prefer staged status; fall back to working-dir status.
  const s = index !== ' ' && index !== '?' && index !== '' ? index : workingDir
  if (s === 'A') return 'A'
  if (s === 'D') return 'D'
  if (s === 'R') return 'R'
  if (s === '?') return '?'
  return 'M'
}

async function readGitText(
  git: ReturnType<typeof simpleGit>,
  spec: string
): Promise<string | null> {
  try {
    return await git.raw(['show', spec])
  } catch {
    return null
  }
}

function readWorkingText(cwd: string, filePath: string): string | null {
  try {
    const fullPath = path.join(cwd, filePath)
    if (!fs.statSync(fullPath).isFile()) return null
    return fs.readFileSync(fullPath, 'utf8')
  } catch {
    return null
  }
}

export function countContentLines(contents: string): number {
  if (!contents) return 0
  return contents.endsWith('\n')
    ? contents.split(/\r?\n/).length - 1
    : contents.split(/\r?\n/).length
}

async function readDiffContents(
  cwd: string,
  git: ReturnType<typeof simpleGit>,
  filePath: string,
  source: 'working' | 'index' | 'branch',
  baseRef?: string
): Promise<Pick<GitFileDiff, 'oldContent' | 'newContent'>> {
  const oldRef = source === 'branch' && baseRef ? `${baseRef}:${filePath}` : `HEAD:${filePath}`
  const oldContent = (await readGitText(git, oldRef)) ?? ''
  const newContent =
    source === 'index'
      ? ((await readGitText(git, `:${filePath}`)) ?? '')
      : (readWorkingText(cwd, filePath) ?? '')
  return { oldContent, newContent }
}

export function resolveGitDir(cwd: string, gitDir: string): string {
  if (gitDir.startsWith('/')) return gitDir
  return path.resolve(cwd, gitDir)
}

function gitFileExists(gitDir: string, name: string): boolean {
  return fs.existsSync(path.join(gitDir, name))
}

function gitDirExists(gitDir: string, name: string): boolean {
  try {
    return fs.statSync(path.join(gitDir, name)).isDirectory()
  } catch {
    return false
  }
}

async function detectGitOperation(cwd: string): Promise<GitOperation> {
  const git = simpleGit({ baseDir: cwd })
  const rawGitDir = await git.raw(['rev-parse', '--git-dir']).catch(() => '')
  const gitDir = resolveGitDir(cwd, rawGitDir.trim())
  if (gitFileExists(gitDir, 'MERGE_HEAD')) return 'merge'
  if (gitDirExists(gitDir, 'rebase-merge') || gitDirExists(gitDir, 'rebase-apply')) return 'rebase'
  if (gitFileExists(gitDir, 'CHERRY_PICK_HEAD')) return 'cherry-pick'
  return 'none'
}

// ─── Workspace summary ─────────────────────────────────────────────────────

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

// ─── Git status ────────────────────────────────────────────────────────────

export async function getGitStatus(cwd: string): Promise<GitStatusResult> {
  return withGitLock(cwd, async () => {
    const git = simpleGit({ baseDir: cwd })
    const [status, unstagedSummary, stagedSummary, operation, stashList] = await Promise.all([
      git.status(),
      git.diffSummary().catch(() => null),
      git.diffSummary(['--staged']).catch(() => null),
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
      const stats = isStaged
        ? (stagedMap.get(f.path) ?? { added: 0, removed: 0 })
        : (unstagedMap.get(f.path) ?? { added: 0, removed: 0 })
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

// ─── File diff ─────────────────────────────────────────────────────────────

export function countDiffLines(raw: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const line of raw.split('\n')) {
    // Git writes the file headers as `+++ b/path` / `--- a/path`, with a space.
    // Without requiring it, a removed markdown `---` line arrives as `----` and
    // was dropped from the count.
    if (line.startsWith('+') && !line.startsWith('+++ ')) added++
    else if (line.startsWith('-') && !line.startsWith('--- ')) removed++
  }
  return { added, removed }
}

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
        const raw = await git.raw(['diff', `${base}...HEAD`, '--unified=3', '--', filePath])
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
        const raw = await git.raw(['diff', '--staged', '--unified=3', '--', filePath])
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
        const raw = await git.raw(['diff', '--unified=3', '--', filePath])
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
      const raw = await git.raw(['diff', '--unified=3', '--', filePath])
      if (!raw.trim()) {
        const stagedRaw = await git.raw(['diff', '--staged', '--unified=3', '--', filePath])
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

// ─── Commit diff ───────────────────────────────────────────────────────────

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

// ─── Remote URL ────────────────────────────────────────────────────────────

export async function getGitRemoteUrl(cwd: string): Promise<string | null> {
  const git = simpleGit({ baseDir: cwd })
  const remotes = await git.getRemotes(true)
  return remotes[0]?.refs?.fetch ?? null
}

// ─── Phase 3: Scoped diffs ────────────────────────────────────────────────────

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
        const raw = await git.raw(['diff', '--staged', '--unified=3', '--', f])
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
      const summary = await git.diffSummary([`${effectiveBase}...HEAD`])
      if (!summary.files.length) return null

      const result: Record<string, GitFileDiff> = {}
      for (const f of summary.files) {
        const filePath = f.file
        const raw = await git.raw([
          'diff',
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
