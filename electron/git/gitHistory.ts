/**
 * gitHistory.ts — Git log history and refs (branches, tags, stashes).
 * Extracted from gitHost.ts.
 */

import simpleGit from 'simple-git'
import type {
  GitGraphColumn,
  GitGraphRow,
  GitHistoryCommit,
  GitRefsResult,
  GitStashEntry,
} from '../../src/lib/ipc'
import { gitRefsResultSchema } from '../../src/lib/ipc'

// ─── Graph parsing ─────────────────────────────────────────────────────────

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

// ─── Commit history ────────────────────────────────────────────────────────

export async function getGitHistory(
  cwd: string,
  query = '',
  limit = 100
): Promise<{ graphRows: GitGraphRow[]; commits: GitHistoryCommit[] }> {
  const git = simpleGit({ baseDir: cwd })

  // Use \x01 (SOH) as field delimiter — it never appears in graph output,
  // avoiding the "|" ambiguity with graph characters like `|`.
  const logOutput = await git.raw([
    'log',
    `--max-count=${Math.min(Math.max(limit, 1), 200)}`,
    '--graph',
    '--pretty=format:%x01%H%x01%P%x01%an%x01%ae%x01%ai%x01%s%x01%D',
    '--all',
    ...(query ? ['--grep', query, '-i', '--regexp-ignore-case'] : []),
  ])

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
        statsQueries.push(hash)
        statsTargets.push(commits.length)
        const shortHash = hash.slice(0, 7)
        commits.push({
          hash,
          shortHash,
          parentHashes,
          message,
          date,
          authorName,
          authorEmail,
          refs,
          graph,
          stats: '',
        })
        graphRows.push({ columns, commitHash: hash })
      }
    } else {
      // Graph-only continuation row
      graphRows.push({ columns })
    }
  }

  // Fetch stats (added/removed) in batch using diff-tree --numstat
  if (statsQueries.length > 0) {
    try {
      const statsOutput = await git.raw([
        'diff-tree',
        '--no-commit-id',
        '-r',
        '--numstat',
        ...statsQueries,
      ])
      const lines = statsOutput.split('\n').filter(Boolean)
      let commitIdx = 0
      for (const line of lines) {
        const parts = line.split('\t')
        if (parts.length === 3 && parts[0] && parts[1] && !Number.isNaN(Number(parts[0]))) {
          const c = commits[statsTargets[commitIdx]!]
          if (c) {
            const added = Number(parts[0]) || 0
            const removed = Number(parts[1]) || 0
            c.stats = `${added} insertion${added !== 1 ? 's' : ''}(+), ${removed} deletion${removed !== 1 ? 's' : ''}(-)`
          }
        } else if (parts.length >= 2) {
          commitIdx++
        }
      }
    } catch {
      // stats are non-critical
    }
  }

  return { graphRows, commits }
}

// ─── Refs (branches, tags, stashes) ────────────────────────────────────────

export async function getGitRefs(cwd: string): Promise<GitRefsResult> {
  const git = simpleGit({ baseDir: cwd })
  const [branches, stashSummary] = await Promise.all([git.branch(['--all']), git.stashList()])

  const branchRefs: GitBranchRef[] = branches.all.map((name) => ({
    name,
    label: name.replace(/^remotes\//, ''),
    commit: '',
    current: name === branches.current,
    remote: name.startsWith('remotes/'),
  }))

  const stashes: GitStashEntry[] = stashSummary.all.map((stash, index) => ({
    index,
    hash: stash.hash ?? '',
    message: stash.message,
    date: stash.date ?? '',
  }))

  return gitRefsResultSchema.parse({ branches: branchRefs, stashes })
}

import type { GitBranchRef } from '../../src/lib/ipc'
