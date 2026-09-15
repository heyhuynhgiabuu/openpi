/**
 * fffFallback.ts — Filesystem-based fallback search when @ff-labs/fff-node
 * is unavailable. Extracted from fffHost.ts.
 */

import fs from 'node:fs'
import path from 'node:path'
import type { FffFileResult, FffGrepMatch, FffGrepOpts } from './fffHost'

/** Matches the native index's per-file cap: reading a huge file blocks main. */
const MAX_FILE_SIZE = 10_000_000

const FALLBACK_SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'out',
  'dist',
  'dist-electron',
  'release',
  'coverage',
  'playwright-report',
  'test-results',
])

export function fallbackFileSearch(
  cwd: string | null,
  query: string,
  pageSize: number
): FffFileResult[] {
  if (!cwd) return []
  const normalizedQuery = query.trim().toLowerCase()
  const hits: Array<FffFileResult & { score: number }> = []
  const stack = ['']
  let visited = 0
  const maxVisited = 8000

  while (stack.length > 0 && visited < maxVisited) {
    const relDir = stack.pop() ?? ''
    const absDir = path.join(cwd, relDir)
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      visited++
      if (FALLBACK_SKIP_DIRS.has(entry.name)) continue
      if (entry.name.startsWith('.')) continue

      const childRel = relDir ? `${relDir}/${entry.name}` : entry.name

      if (entry.isDirectory()) {
        stack.push(childRel)
      } else if (entry.isFile()) {
        const score = fallbackScore(childRel, entry.name, normalizedQuery)
        if (score !== null) {
          hits.push({
            relativePath: childRel,
            fileName: entry.name,
            dir: relDir,
            score,
          })
        }
      }
    }
  }

  hits.sort((a, b) => b.score - a.score)
  return hits.slice(0, pageSize).map(({ score: _s, ...rest }) => rest)
}

function fallbackScore(relativePath: string, fileName: string, query: string): number | null {
  const lowerPath = relativePath.toLowerCase()
  if (!lowerPath.includes(query)) return null

  let score = 0
  if (fileName.toLowerCase() === query) score += 100
  else if (fileName.toLowerCase().startsWith(query)) score += 50
  else if (fileName.toLowerCase().includes(query)) score += 20
  score += Math.max(0, 50 - relativePath.length)
  score -= (relativePath.split('/').length - 1) * 5
  return score
}

// ─── Grep fallback ─────────────────────────────────────────────────────────

export function fallbackGrep(cwd: string | null, query: string, opts: FffGrepOpts): FffGrepMatch[] {
  if (!cwd) return []
  // The host passes its own default through, so an unbounded walk is only
  // possible when a caller asks for one explicitly.
  const deadline = Date.now() + Math.max(0, opts.timeBudgetMs ?? 3000)
  return grepDir(cwd, '', query, opts, deadline)
}

function grepDir(
  cwd: string,
  relDir: string,
  query: string,
  opts: FffGrepOpts,
  deadline: number
): FffGrepMatch[] {
  const results: FffGrepMatch[] = []
  // Checked per directory: the walk is recursive, so this bounds the whole tree
  // without a clock read per entry. A single directory with a very large number
  // of files is still walked to the end.
  if (Date.now() >= deadline) return results
  const absDir = relDir ? path.join(cwd, relDir) : cwd
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true })
  } catch {
    return results
  }

  const matcher = createFallbackMatcher(query, opts)

  for (const entry of entries) {
    if (FALLBACK_SKIP_DIRS.has(entry.name)) continue
    if (entry.name.startsWith('.')) continue

    const childRel = relDir ? `${relDir}/${entry.name}` : entry.name

    if (entry.isDirectory()) {
      results.push(...grepDir(cwd, childRel, query, opts, deadline))
    } else if (entry.isFile()) {
      const fullPath = path.join(cwd, childRel)
      try {
        if (fs.statSync(fullPath).size > MAX_FILE_SIZE) continue
        const content = fs.readFileSync(fullPath, 'utf-8')
        if (/\0/.test(content)) continue
        results.push(...matcher(content, childRel))
      } catch {
        // skip unreadable files
      }
    }
  }

  return results
}

function createFallbackMatcher(
  query: string,
  opts: FffGrepOpts
): (content: string, relativePath: string) => FffGrepMatch[] {
  // Defaults match what fffGrep passes to the native search.
  const smartCase = opts.smartCase ?? true
  const flags = smartCase && query === query.toLowerCase() ? 'gi' : 'g'
  // A regex search that silently ran as a literal one matched the pattern's own
  // text and missed real hits.
  const pattern = opts.mode === 'regex' ? query : escapeSearchQuery(query)
  const limit = Math.max(1, opts.maxMatchesPerFile ?? 5)
  let regex: RegExp | null = null
  try {
    regex = new RegExp(pattern, flags)
  } catch {
    regex = null
  }

  return (content: string, relativePath: string): FffGrepMatch[] => {
    if (!regex) return []
    const matches: FffGrepMatch[] = []
    regex.lastIndex = 0
    for (let match = regex.exec(content); match !== null && matches.length < limit;) {
      // A zero-length match highlights nothing, and advancing past it keeps the
      // scan moving.
      if (match[0].length > 0) {
        const lineStart = content.lastIndexOf('\n', match.index) + 1
        const lineEnd = content.indexOf('\n', match.index + match[0].length)
        const lineContent =
          lineEnd !== -1 ? content.slice(lineStart, lineEnd) : content.slice(lineStart)
        const start = match.index - lineStart
        matches.push({
          relativePath,
          fileName: path.basename(relativePath),
          lineNumber: content.slice(0, match.index).split('\n').length,
          lineContent,
          matchRanges: [[start, start + match[0].length - 1]],
        })
      }
      if (match[0].length === 0) regex.lastIndex += 1
      match = regex.exec(content)
    }
    return matches
  }
}

function escapeSearchQuery(query: string): string {
  return query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
