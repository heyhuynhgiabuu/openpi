/**
 * gitHost.ts — Git authority for OpenPi.
 *
 * ALL git mutations (stage, unstage, commit, push, discard) run exclusively here,
 * in Electron main. The renderer never touches git directly.
 *
 * Uses simple-git. Never uses `git add .` or `git add -A`; always passes
 * explicit file paths.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import simpleGit from 'simple-git'
import type {
  FileTreeNode,
  FileTreeResult,
  GitChangedFile,
  GitFileDiff,
  GitOperation,
  GitStatusResult,
  WorkspaceSummaryInfo,
} from '../src/lib/ipc'

// ─── Workspace summary ─────────────────────────────────────────────────────

function timestampFromDate(value: string | Date | null | undefined): number | null {
  if (!value) return null
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

function statMtimeMs(fullPath: string): number | null {
  try {
    return fs.statSync(fullPath).mtimeMs
  } catch {
    return null
  }
}

export async function getWorkspaceSummary(cwd: string): Promise<WorkspaceSummaryInfo> {
  let branch: string | null = null
  const timestamps: number[] = []

  const cwdMtime = statMtimeMs(cwd)
  if (cwdMtime != null) timestamps.push(cwdMtime)

  try {
    const git = simpleGit({ baseDir: cwd })
    const branchInfo = await git.branch()
    branch = branchInfo.current || null

    const latestCommit = (await git.raw(['log', '-1', '--format=%cI']).catch(() => '')).trim()
    const commitTimestamp = timestampFromDate(latestCommit)
    if (commitTimestamp != null) timestamps.push(commitTimestamp)

    const status = await git.status().catch(() => null)
    for (const file of status?.files ?? []) {
      const fileMtime = statMtimeMs(path.join(cwd, file.path))
      if (fileMtime != null) timestamps.push(fileMtime)
    }
  } catch {
    // Non-git folders still get workspace identity and directory mtime.
  }

  const lastModifiedMs = timestamps.length > 0 ? Math.max(...timestamps) : null

  return {
    cwd,
    displayName: path.basename(cwd) || cwd,
    branch,
    lastModifiedAt: lastModifiedMs == null ? null : new Date(lastModifiedMs).toISOString(),
  }
}

// ─── Status ────────────────────────────────────────────────────────────────

function effectiveStatus(index: string, workingDir: string): GitChangedFile['status'] {
  if (index === 'U' || workingDir === 'U') return 'U'

  // Prefer staged status; fall back to working-dir status.
  const s = index !== ' ' && index !== '?' && index !== '' ? index : workingDir
  if (s === 'A') return 'A'
  if (s === 'D') return 'D'
  if (s === 'R') return 'R'
  if (s === '?') return '?'
  return 'M'
}

function resolveGitDir(cwd: string, gitDir: string): string {
  return path.isAbsolute(gitDir) ? gitDir : path.resolve(cwd, gitDir)
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
  const rawGitDir = (await git.raw(['rev-parse', '--git-dir']).catch(() => '.git')).trim()
  const gitDir = resolveGitDir(cwd, rawGitDir)

  if (gitFileExists(gitDir, 'MERGE_HEAD')) return 'merge'
  if (gitDirExists(gitDir, 'rebase-merge') || gitDirExists(gitDir, 'rebase-apply')) return 'rebase'
  if (gitFileExists(gitDir, 'CHERRY_PICK_HEAD')) return 'cherry-pick'
  return 'none'
}

export async function getGitStatus(cwd: string): Promise<GitStatusResult> {
  const git = simpleGit({ baseDir: cwd })

  const [status, unstagedSummary, stagedSummary, operation, stashList] = await Promise.all([
    git.status(),
    git.diffSummary().catch(() => null),
    git.diffSummary(['--staged']).catch(() => null),
    detectGitOperation(cwd),
    git.stashList().catch(() => ({ total: 0 })),
  ])

  // Build per-file line-count maps
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
    hasConflicts: status.conflicted.length > 0 || files.some((file) => file.status === 'U'),
    operation,
    stashCount: stashList.total,
    totalAdded,
    totalRemoved,
    files,
  }
}

// ─── Diff (raw patch passthrough for @pierre/diffs) ──────────────────────────

/** Count +/- lines in a raw unified diff string */
function countDiffLines(raw: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const line of raw.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added++
    else if (line.startsWith('-') && !line.startsWith('---')) removed++
  }
  return { added, removed }
}

export async function getGitFileDiff(cwd: string, filePath: string): Promise<GitFileDiff> {
  const git = simpleGit({ baseDir: cwd })

  try {
    // Try staged diff first, then working-tree diff.
    // git.diff() returns a standard unified diff string that @pierre/diffs PatchDiff consumes directly.
    let rawPatch = await git.diff(['--unified=3', '--staged', '--', filePath])
    if (!rawPatch) {
      rawPatch = await git.diff(['--unified=3', '--', filePath])
    }

    // Untracked file: construct a minimal patch string showing all lines as additions
    if (!rawPatch) {
      try {
        const fileContent = fs.readFileSync(path.join(cwd, filePath), 'utf-8')
        const lines = fileContent.split('\n')
        const body = lines.map((l) => `+${l}`).join('\n')
        rawPatch = `--- /dev/null\n+++ b/${filePath}\n@@ -0,0 +1,${lines.length} @@\n${body}\n`
        return {
          path: filePath,
          rawPatch,
          totalAdded: lines.length,
          totalRemoved: 0,
          isNew: true,
          isDeleted: false,
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
    }

    const { added, removed } = countDiffLines(rawPatch)
    return {
      path: filePath,
      rawPatch,
      totalAdded: added,
      totalRemoved: removed,
      isNew: false,
      isDeleted: false,
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
}

// ─── Mutations ─────────────────────────────────────────────────────────────

/**
 * Stage a specific file. Never uses `git add .`
 *
 * Three cases:
 *  1. File exists on disk → `git add` (with `--force` retry for gitignored paths)
 *  2. File deleted on disk but tracked in index → `git rm --cached` to stage the deletion
 *  3. File not on disk AND not in index (ghost) → silently ignored
 */
export async function stageFile(cwd: string, filePath: string): Promise<void> {
  const git = simpleGit({ baseDir: cwd })
  const existsOnDisk = fs.existsSync(path.join(cwd, filePath))

  if (!existsOnDisk) {
    // File was deleted from the working tree.
    // Stage the deletion by removing it from the index.
    // `git add --force <deleted-path>` fails when the directory no longer exists;
    // `git rm --cached` is the correct operation here.
    try {
      await git.rm(['--cached', '--', filePath])
    } catch {
      // Not in the index either (ghost entry) — nothing to stage.
    }
    return
  }

  // File exists on disk — normal staging.
  // Retry with --force for files inside gitignored directories (e.g. .beads/).
  try {
    await git.add([filePath])
  } catch (err) {
    if (String(err).includes('ignored by one of your .gitignore files')) {
      await git.add(['--force', filePath])
      return
    }
    throw err
  }
}

/** Unstage a specific file (git reset HEAD -- <file>) */
export async function unstageFile(cwd: string, filePath: string): Promise<void> {
  await simpleGit({ baseDir: cwd }).reset(['HEAD', '--', filePath])
}

/**
 * Commit a set of specific files.
 * Stages each file individually before committing.
 * Never uses `git add .`.
 */
export async function commitFiles(
  cwd: string,
  paths: string[],
  message: string,
  push = false
): Promise<void> {
  const git = simpleGit({ baseDir: cwd })
  // Stage each file explicitly — never use `git add .`
  // Mirrors stageFile() logic: deleted files need `git rm --cached`, not `git add`.
  for (const p of paths) {
    const existsOnDisk = fs.existsSync(path.join(cwd, p))
    if (!existsOnDisk) {
      try {
        await git.rm(['--cached', '--', p])
      } catch {
        /* ghost — not in index, skip */
      }
      continue
    }
    try {
      await git.add([p])
    } catch (err) {
      if (String(err).includes('ignored by one of your .gitignore files')) {
        await git.add(['--force', p])
      } else {
        throw err
      }
    }
  }
  await git.commit(message)
  if (push) {
    await git.push()
  }
}

/** Discard working-tree changes for a tracked file (git checkout -- <file>) */
export async function discardFile(cwd: string, filePath: string): Promise<void> {
  await simpleGit({ baseDir: cwd }).checkout(['--', filePath])
}

// ─── Polling watcher ────────────────────────────────────────────────────────

let pollTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Start polling git status every 3 seconds.
 * Calls onChange with the latest status on each tick.
 * Stops any previous poll first.
 */
export function startGitPoll(cwd: string, onChange: (status: GitStatusResult) => void): void {
  stopGitPoll()

  const tick = async () => {
    try {
      const status = await getGitStatus(cwd)
      onChange(status)
    } catch {
      // not a git repo or git not available — just skip
    }
    pollTimer = setTimeout(tick, 3000)
  }

  // Initial status after a short delay
  pollTimer = setTimeout(tick, 800)
}

export function stopGitPoll(): void {
  if (pollTimer) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
}

// ─── File tree ───────────────────────────────────────────────────────────────────

/** Directories to hide from the file tree */
const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  '.next',
  'dist',
  'build',
  'out',
  '__pycache__',
  '.venv',
  'venv',
  'target',
  '.cargo',
  '.turbo',
  '.pnp',
  '.expo',
  'coverage',
  '.cache',
  '.parcel-cache',
])

const MAX_FILE_TREE_DEPTH = 12
const MAX_FILE_TREE_NODES = 5000
const FILE_TREE_WATCH_DEBOUNCE_MS = 150

let fileTreeWatcher: fs.FSWatcher | null = null
let fileTreeWatchTimer: ReturnType<typeof setTimeout> | null = null

function pathContainsIgnoredDir(relPath: string): boolean {
  return relPath
    .split(/[\\/]+/)
    .filter(Boolean)
    .some((part) => IGNORED_DIRS.has(part))
}

function shouldIgnoreFileTreeEvent(filename: string | Buffer | null): boolean {
  if (!filename) return false
  return pathContainsIgnoredDir(filename.toString())
}

function readDirEntries(
  cwd: string,
  relPath: string,
  depth: number,
  budget: { remaining: number }
): FileTreeNode[] {
  if (depth <= 0 || budget.remaining <= 0) return []
  const fullPath = relPath ? path.join(cwd, relPath) : cwd
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(fullPath, { withFileTypes: true })
  } catch {
    return []
  }

  const nodes: FileTreeNode[] = []
  for (const entry of entries
    .filter((e) => !(e.isDirectory() && IGNORED_DIRS.has(e.name)))
    .sort((a, b) => {
      const aDir = a.isDirectory()
      const bDir = b.isDirectory()
      if (aDir !== bDir) return aDir ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })) {
    if (budget.remaining <= 0) break
    budget.remaining -= 1

    const childRel = relPath ? `${relPath}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: childRel,
        isDir: true,
        children: readDirEntries(cwd, childRel, depth - 1, budget),
      })
    } else {
      nodes.push({ name: entry.name, path: childRel, isDir: false })
    }
  }

  return nodes
}

/**
 * Build a bounded snapshot of the workspace file tree.
 * Electron main owns filesystem reads; the renderer only displays this result.
 */
export function getFileTree(cwd: string): FileTreeResult {
  return {
    rootName: path.basename(cwd),
    children: readDirEntries(cwd, '', MAX_FILE_TREE_DEPTH, { remaining: MAX_FILE_TREE_NODES }),
  }
}

export function startFileTreeWatch(cwd: string, onChange: () => void): void {
  stopFileTreeWatch()

  const notify = (filename: string | Buffer | null) => {
    if (shouldIgnoreFileTreeEvent(filename)) return
    if (fileTreeWatchTimer) clearTimeout(fileTreeWatchTimer)
    fileTreeWatchTimer = setTimeout(() => {
      fileTreeWatchTimer = null
      onChange()
    }, FILE_TREE_WATCH_DEBOUNCE_MS)
  }

  try {
    fileTreeWatcher = fs.watch(cwd, { recursive: true }, (_eventType, filename) => {
      notify(filename)
    })
  } catch {
    fileTreeWatcher = fs.watch(cwd, (_eventType, filename) => {
      notify(filename)
    })
  }
}

export function stopFileTreeWatch(): void {
  if (fileTreeWatchTimer) {
    clearTimeout(fileTreeWatchTimer)
    fileTreeWatchTimer = null
  }
  if (fileTreeWatcher) {
    fileTreeWatcher.close()
    fileTreeWatcher = null
  }
}

// ─── Content search ──────────────────────────────────────────────────────────────────

import type { ContentMatch, FileContentHit } from '../src/lib/ipc'

const BINARY_PATTERN = /\0/ // null byte → treat as binary
const MAX_FILE_SIZE = 1_000_000 // 1 MB
const MAX_FILE_HITS = 50 // max files in results
const MAX_LINE_HITS = 5 // max matching lines per file

/** Escape a literal string for use inside a RegExp. */
function escapeRegexMain(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Collect all non-overlapping [start, end] ranges for `regex` in `text`. */
function getContentRanges(text: string, regex: RegExp): [number, number][] {
  const ranges: [number, number][] = []
  const r = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`)
  let match = r.exec(text)
  while (match !== null) {
    ranges.push([match.index, match.index + match[0].length - 1])
    if (match[0].length === 0) r.lastIndex++
    match = r.exec(text)
  }
  return ranges
}

/**
 * Search the text content of every non-binary file under `cwd`.
 * Respects the same IGNORED_DIRS blocklist used by getFileTree.
 * Time-bounded: stops after MAX_FILE_HITS matching files.
 */
export function searchFileContents(
  cwd: string,
  query: string,
  matchCase: boolean,
  wholeWord: boolean,
  useRegex: boolean
): FileContentHit[] {
  if (!query.trim()) return []

  // Build search regex
  let regex: RegExp
  try {
    let pattern = useRegex ? query : escapeRegexMain(query)
    if (wholeWord) pattern = `\\b${pattern}\\b`
    const flags = matchCase ? 'g' : 'gi'
    regex = new RegExp(pattern, flags)
  } catch {
    return [] // invalid regex — renderer shows the error, main returns empty
  }

  const results: FileContentHit[] = []

  /** Search a single file and push a hit if any lines match. */
  function searchFile(relPath: string): void {
    const full = path.join(cwd, relPath)
    let content: string
    try {
      const stat = fs.statSync(full)
      if (!stat.isFile() || stat.size > MAX_FILE_SIZE) return
      content = fs.readFileSync(full, 'utf-8')
      if (BINARY_PATTERN.test(content)) return
    } catch {
      return
    }

    const lines = content.split('\n')
    const matches: ContentMatch[] = []

    for (let i = 0; i < lines.length && matches.length < MAX_LINE_HITS; i++) {
      regex.lastIndex = 0
      if (!regex.test(lines[i])) continue
      regex.lastIndex = 0
      matches.push({
        lineNumber: i + 1,
        text: lines[i],
        ranges: getContentRanges(lines[i], regex),
      })
    }

    if (matches.length > 0) results.push({ path: relPath, matches })
  }

  /** Recursively walk all files, respecting IGNORED_DIRS. */
  function walk(relDir: string): void {
    if (results.length >= MAX_FILE_HITS) return
    const full = relDir ? path.join(cwd, relDir) : cwd
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(full, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (results.length >= MAX_FILE_HITS) break
      const childRel = relDir ? `${relDir}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) walk(childRel)
      } else if (entry.isFile()) {
        searchFile(childRel)
      }
    }
  }

  walk('')
  return results
}
