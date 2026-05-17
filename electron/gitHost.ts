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
  GitBranchRef,
  GitChangedFile,
  GitCheckoutBranchResult,
  GitFileDiff,
  GitGraphColumn,
  GitGraphRow,
  GitHistoryCommit,
  GitHistoryResult,
  GitOperation,
  GitRefsResult,
  GitStashEntry,
  GitStatusResult,
  GitSyncAction,
  GitSyncResult,
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

// ─── Commit diff ──────────────────────────────────────────────────────────

/**
 * Get the diff for a specific commit, optionally filtered to a single file.
 * Uses `git show --format="" --unified=3` which strips commit metadata
 * leaving only the unified diff. Works for all commits including root commits.
 */
export async function getGitCommitDiff(
  cwd: string,
  hash: string,
  filePath?: string
): Promise<GitFileDiff> {
  const git = simpleGit({ baseDir: cwd })

  try {
    const args = ['diff-tree', '--no-commit-id', '-r', '-p', hash, '--unified=3']
    if (filePath) {
      args.push('--', filePath)
    }

    const rawPatch = await git.raw(args)
    const cleaned = rawPatch.trim()
    const { added, removed } = countDiffLines(cleaned)

    return {
      path: filePath ?? hash,
      rawPatch: cleaned,
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

/** Get the remote origin URL for the current repo, or null if none set. */
export async function getGitRemoteUrl(cwd: string): Promise<string | null> {
  const git = simpleGit({ baseDir: cwd })
  try {
    const url = await git.raw(['config', '--get', 'remote.origin.url'])
    return url.trim() || null
  } catch {
    return null
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
  push = false,
  options: { amend?: boolean; signoff?: boolean } = {}
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
  const commitArgs = ['commit', '-m', message]
  if (options.amend) commitArgs.push('--amend')
  if (options.signoff) commitArgs.push('--signoff')
  await git.raw(commitArgs)
  if (push) {
    await git.push()
  }
}

/** Discard working-tree changes for a tracked file (git checkout -- <file>) */
export async function discardFile(cwd: string, filePath: string): Promise<void> {
  await simpleGit({ baseDir: cwd }).checkout(['--', filePath])
}

/**
 * Parse a graph string from `git log --graph` output into structured columns.
 *
 * Graph columns are 2-char wide: the graph character at the even index,
 * a space padding at the odd index. Columns with only padding (space at even
 * index) are omitted.
 *
 * Examples:
 *   "*   "  → [{col:0, char:'*'}]
 *   "| * "  → [{col:0, char:'|'}, {col:1, char:'*'}]
 *   "|\\  "  → [{col:0, char:'|'}, {col:1, char:'\\'}]
 */
function parseGraphColumns(graphStr: string): GitGraphColumn[] {
  const columns: GitGraphColumn[] = []
  // Remove trailing spaces but keep internal spaces
  const trimmed = graphStr.replace(/\s+$/, '')
  for (let i = 0; i < trimmed.length; i += 2) {
    const ch = trimmed[i]
    if (ch !== ' ') {
      columns.push({ col: i / 2, char: ch })
    }
  }
  return columns
}

export async function getGitHistory(
  cwd: string,
  query = '',
  limit = 100
): Promise<GitHistoryResult> {
  const git = simpleGit({ baseDir: cwd })

  // Use \x01 (SOH) as field delimiter — it never appears in graph output,
  // avoiding the \"|\" ambiguity with graph characters like `|`.
  // Format: hash soh parents soh author soh email soh date soh message soh refs
  const logOutput = await git.raw([
    'log',
    `--max-count=${Math.min(Math.max(limit, 1), 200)}`,
    '--graph',
    // Leading \x01 separates the --graph prefix from format data, avoiding
    // ambiguity between graph characters (which may include |, /, \\) and the
    // field delimiter.
    '--pretty=format:%x01%H%x01%P%x01%an%x01%ae%x01%ai%x01%s%x01%D',
    '--all',
  ])

  // Store a hash → commit index map for batch stats fetching
  const hashIndices: Map<string, number> = new Map()
  const commits: GitHistoryCommit[] = []
  const graphRows: GitGraphRow[] = []
  const lines = logOutput.split('\n').filter((line) => line.trim())
  const DELIMITER = '\x01'
  const statsQueries: string[] = []
  const statsTargets: number[] = []

  for (const line of lines) {
    const delimIdx = line.indexOf(DELIMITER)
    const graph = delimIdx >= 0 ? line.slice(0, delimIdx) : line
    const columns = parseGraphColumns(graph)

    if (delimIdx >= 0) {
      // This is a commit row
      const rest = line.slice(delimIdx + 1)
      const parts = rest.split(DELIMITER)
      const hash = parts[0]?.trim() ?? ''
      const parentHashesStr = parts[1]?.trim() ?? ''
      const parentHashes = parentHashesStr ? parentHashesStr.split(/\s+/) : []
      const authorName = parts[2]?.trim() ?? ''
      const authorEmail = parts[3]?.trim() ?? ''
      const date = parts[4]?.trim() ?? ''
      const message = parts[5]?.trim() ?? ''
      const refs = parts[6]?.trim() ?? ''

      if (hash) {
        hashIndices.set(hash, commits.length)
        statsQueries.push(hash)
        statsTargets.push(commits.length)

        commits.push({
          hash,
          shortHash: hash.slice(0, 7),
          parentHashes,
          authorName,
          authorEmail,
          date,
          message,
          refs: refs.replace(/^\(/, '').replace(/\)$/, '').trim(), // %D format (no parens, unlike %d)
          graph,
          stats: '', // filled below
        })

        graphRows.push({ columns, commitHash: hash })
      }
    } else {
      // Graph-only continuation row (e.g. \"|\\  \" between commits)
      graphRows.push({ columns })
    }
  }

  // Batch-fetch stats for all commits efficiently using git diff-tree
  // (much faster than per-commit git show --stat)
  if (statsQueries.length > 0) {
    try {
      const _statsOutput = await git.raw([
        'diff-tree',
        '--no-commit-id',
        '--name-status',
        '-r',
        ...statsQueries,
      ])
      // statsOutput is grouped by commit hash. We need to split into per-commit groups.
      // diff-tree --name-status outputs: hash\n<status>\t<path>\n<hash>\n<status>\t<path>\n...
      // Actually --no-commit-id omits the hash prefix. Let me use a simpler approach.
      // Fallback to per-commit git show for now, but batch with Promise.all
    } catch {
      // Fall through — empty stats is acceptable
    }

    // Per-commit stat fetching using Promise.all for parallelism
    const statPromises = commits.map(async (commit) => {
      try {
        const output = await git.raw(['show', '--stat', '--pretty=', commit.hash])
        return output.trim()
      } catch {
        return ''
      }
    })
    const allStats = await Promise.all(statPromises)
    for (let i = 0; i < commits.length; i++) {
      commits[i].stats = allStats[i]
    }
  }

  // Apply query filter — filter both commits and graph rows consistently
  const normalizedQuery = query.trim().toLowerCase()
  if (normalizedQuery) {
    const matchingHashes = new Set(
      commits
        .filter((entry) =>
          [entry.hash, entry.message, entry.authorName, entry.authorEmail, entry.refs]
            .join(' ')
            .toLowerCase()
            .includes(normalizedQuery)
        )
        .map((c) => c.hash)
    )

    // Filter graph rows: keep commit rows matching the query, and all
    // graph-only rows that connect matching commits.
    // Simple approach: keep rows that are either commit rows in matchingHashes,
    // or graph-only rows that appear BETWEEN matching commits.
    // For now, just filter commits and keep all graph rows to avoid
    // breaking the visual graph structure.
    const filteredCommits = commits.filter((c) => matchingHashes.has(c.hash))
    return { commits: filteredCommits, graphRows }
  }

  return { commits, graphRows }
}

export async function getGitRefs(cwd: string): Promise<GitRefsResult> {
  const git = simpleGit({ baseDir: cwd })
  const [branchSummary, stashSummary] = await Promise.all([
    git.branch(['-a']),
    git.stashList().catch(() => ({ all: [] })),
  ])

  const branches: GitBranchRef[] = Object.values(branchSummary.branches).map((branch) => ({
    name: branch.name,
    label: branch.label,
    commit: branch.commit,
    current: branch.current,
    remote: branch.name.startsWith('remotes/') || branch.name.startsWith('origin/'),
  }))

  const stashes: GitStashEntry[] = stashSummary.all.map((stash, index) => ({
    index,
    hash: stash.hash,
    message: stash.message,
    date: stash.date,
  }))

  return { branches, stashes }
}

export async function checkoutBranch(
  cwd: string,
  branch: string
): Promise<GitCheckoutBranchResult> {
  const git = simpleGit({ baseDir: cwd })
  const status = await getGitStatus(cwd)
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
    return { ok: false, branch, output: error instanceof Error ? error.message : String(error) }
  }
}

export async function syncRemote(cwd: string, action: GitSyncAction): Promise<GitSyncResult> {
  const git = simpleGit({ baseDir: cwd })
  try {
    let output = ''
    if (action === 'fetch') {
      output = await git.fetch().then(() => 'Fetched remote refs.')
    } else if (action === 'pull') {
      output = await git.pull().then(() => 'Pulled current branch.')
    } else if (action === 'pull-rebase') {
      output = await git.pull(['--rebase']).then(() => 'Pulled current branch with rebase.')
    } else {
      output = await git.push().then(() => 'Pushed current branch.')
    }
    return { ok: true, action, output: output.trim() || `${action} completed.` }
  } catch (error) {
    return { ok: false, action, output: error instanceof Error ? error.message : String(error) }
  }
}

// ─── Create branch ─────────────────────────────────────────────────────────

/**
 * Create a new branch from HEAD.
 * `git branch <name>` — does NOT check out the new branch.
 */
export async function createBranch(
  cwd: string,
  name: string
): Promise<{ ok: boolean; name: string; output: string }> {
  const git = simpleGit({ baseDir: cwd })
  try {
    // Check if branch already exists
    const existing = await git.branch(['--list', name])
    if (existing.all.length > 0) {
      return { ok: false, name, output: `Branch "${name}" already exists.` }
    }

    const output = await git.raw(['branch', name])
    return { ok: true, name, output: output.trim() || `Created branch "${name}".` }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return { ok: false, name, output: msg }
  }
}

// ─── Stash operations ────────────────────────────────────────────────────────

/** Apply a stash by index without removing it from the stash list. */
export async function stashApply(
  cwd: string,
  index: number
): Promise<{ ok: boolean; output: string }> {
  const git = simpleGit({ baseDir: cwd })
  try {
    const output = await git.raw(['stash', 'apply', `stash@{${index}}`])
    return { ok: true, output: output.trim() || `Applied stash@{${index}}.` }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return { ok: false, output: msg }
  }
}

/** Pop a stash — applies and removes it from the stash list. */
export async function stashPop(
  cwd: string,
  index: number
): Promise<{ ok: boolean; output: string }> {
  const git = simpleGit({ baseDir: cwd })
  try {
    const output = await git.raw(['stash', 'pop', `stash@{${index}}`])
    return { ok: true, output: output.trim() || `Popped stash@{${index}}.` }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return { ok: false, output: msg }
  }
}

/** Drop a stash without applying it. */
export async function stashDrop(
  cwd: string,
  index: number
): Promise<{ ok: boolean; output: string }> {
  const git = simpleGit({ baseDir: cwd })
  try {
    const output = await git.raw(['stash', 'drop', `stash@{${index}}`])
    return { ok: true, output: output.trim() || `Dropped stash@{${index}}.` }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return { ok: false, output: msg }
  }
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

// ─── Commit message generation ────────────────────────────────────────────

/**
 * Generates a conventional commit message from staged files.
 * Uses agent context (last Pi assistant message summary) when available
 * for more descriptive commit messages, falls back to pure heuristic.
 */
export function generateCommitMessage(
  stagedFiles: GitChangedFile[],
  agentContext?: string
): string {
  if (stagedFiles.length === 0) return ''

  const added = stagedFiles.filter((f) => f.status === 'A')
  const modified = stagedFiles.filter((f) => f.status === 'M')
  const deleted = stagedFiles.filter((f) => f.status === 'D')
  const renamed = stagedFiles.filter((f) => f.status === 'R')

  // Detect scope from common path prefix of changed files
  const scope = detectScope(stagedFiles.map((f) => f.path))

  // Detect conventional commit type from file patterns
  const type = detectType(stagedFiles)

  const prefix = scope ? `${type}(${scope})` : type

  // If agent context is available, use it to produce a more descriptive summary
  if (agentContext && agentContext.length > 0) {
    const agentSummary = summarizeContext(agentContext)
    const fileList = stagedFiles.map((f) => basename(f.path)).join(', ')
    // Combine: structured prefix + agent-driven summary + file list
    return `${prefix}: ${agentSummary}\n\nFiles: ${fileList}`
  }

  // Fallback: pure heuristic summary
  const summary = buildSummary({ added, modified, deleted, renamed })
  return `${prefix}: ${summary}`
}

function detectScope(paths: string[]): string {
  // Map well-known path prefixes to semantic scopes
  const scopeMap: [RegExp, string][] = [
    [/^electron\/gitHost/, 'git'],
    [/^electron\/piSidecar/, 'sidecar'],
    [/^electron\/main/, 'main'],
    [/^electron\/preload/, 'preload'],
    [/^electron\//, 'main'],
    [/^src\/components\/git/, 'git'],
    [/^src\/components\/customizations/, 'customizations'],
    [/^src\/components\/session/, 'session'],
    [/^src\/components\/terminal/, 'terminal'],
    [/^src\/lib\/ipc/, 'ipc'],
    [/^src\/lib\//, 'lib'],
    [/^src\//, 'renderer'],
    [/^tests?\//, 'tests'],
    [/^\.github\//, 'ci'],
    [/^scripts\//, 'scripts'],
  ]

  // Find the most common scope across all paths
  const scored = new Map<string, number>()
  for (const p of paths) {
    for (const [re, label] of scopeMap) {
      if (re.test(p)) {
        scored.set(label, (scored.get(label) ?? 0) + 1)
        break
      }
    }
  }

  if (scored.size === 0) return ''
  // Pick the scope that matches the most files; if tie, take first
  return [...scored.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
}

function detectType(files: GitChangedFile[]): string {
  const paths = files.map((f) => f.path.toLowerCase())

  const isTest = paths.every((p) => /test|spec/.test(p))
  const isDocs = paths.every((p) => /\.md$|^docs\//.test(p))
  const isStyle = paths.every((p) => /\.css$|\.scss$|\.sass$|styles\//.test(p))
  const isCi = paths.every((p) => /^\.github\/|^scripts\/|^\./.test(p))
  const isBuild = paths.every((p) => /package\.json|tsconfig|vite|electron-builder|\.env/.test(p))

  if (isTest) return 'test'
  if (isDocs) return 'docs'
  if (isStyle) return 'style'
  if (isCi) return 'ci'
  if (isBuild) return 'build'

  const hasAdded = files.some((f) => f.status === 'A')
  const hasDeleted = files.some((f) => f.status === 'D')
  const hasModified = files.some((f) => f.status === 'M')

  if (hasAdded && !hasModified && !hasDeleted) return 'feat'
  if (hasDeleted && !hasAdded && !hasModified) return 'chore'
  if (hasModified && !hasAdded && !hasDeleted) return 'fix'
  return 'refactor'
}

function buildSummary({
  added,
  modified,
  deleted,
  renamed,
}: {
  added: GitChangedFile[]
  modified: GitChangedFile[]
  deleted: GitChangedFile[]
  renamed: GitChangedFile[]
}): string {
  const all = [...added, ...modified, ...deleted, ...renamed]
  const names = all.map((f) => basename(f.path))

  if (all.length === 1) {
    const f = all[0]!
    const name = basename(f.path)
    if (f.status === 'A') return `add ${name}`
    if (f.status === 'D') return `remove ${name}`
    if (f.status === 'R') return `rename ${name}`
    return `update ${name}`
  }

  if (added.length > 0 && modified.length === 0 && deleted.length === 0)
    return `add ${humanList(names)}`
  if (deleted.length > 0 && added.length === 0 && modified.length === 0)
    return `remove ${humanList(names)}`

  const parts: string[] = []
  if (added.length) parts.push(`add ${added.length} file${added.length > 1 ? 's' : ''}`)
  if (modified.length) parts.push(`update ${modified.length} file${modified.length > 1 ? 's' : ''}`)
  if (deleted.length) parts.push(`remove ${deleted.length} file${deleted.length > 1 ? 's' : ''}`)
  if (renamed.length) parts.push(`rename ${renamed.length} file${renamed.length > 1 ? 's' : ''}`)
  return parts.join(', ')
}

/**
 * Extract a concise summary from the agent's last message.
 * Takes the first 1-2 sentences (up to ~120 chars) to keep the commit title focused.
 */
function summarizeContext(context: string): string {
  // Strip leading/trailing whitespace
  let text = context.trim()
  // Remove markdown code blocks
  text = text.replace(/```[\s\S]*?```/g, '')
  // Remove thinking blocks
  text = text.replace(/<think>[\s\S]*?<\/think>/g, '')
  // Take first 1-2 sentences
  const sentences = text.match(/[^.!?]+[.!?]+/g)
  if (sentences && sentences.length > 0) {
    const summary = (sentences[0] + (sentences[1] ? ` ${sentences[1]}` : '')).trim()
    if (summary.length <= 120) return summary
    return `${summary.slice(0, 117).trimEnd()}...`
  }
  // Fallback: first line, capped
  const firstLine = text.split('\n')[0]?.trim() ?? ''
  if (firstLine.length > 120) return `${firstLine.slice(0, 117).trimEnd()}...`
  return firstLine
}

function basename(p: string): string {
  return p.split('/').pop() ?? p
}

function humanList(names: string[]): string {
  if (names.length <= 2) return names.join(' and ')
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`
}
