/**
 * fffFallback.ts — Filesystem-based fallback search when @ff-labs/fff-node
 * is unavailable. Extracted from fffHost.ts.
 */

import fs from 'node:fs'
import path from 'node:path'
import type { FffFileResult, FffGrepMatch, FffGrepOpts } from './fffHost'

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
  const matched = grepDir(cwd, '', query, opts)
  return matched
}

function grepDir(cwd: string, relDir: string, query: string, opts: FffGrepOpts): FffGrepMatch[] {
  const results: FffGrepMatch[] = []
  const absDir = relDir ? path.join(cwd, relDir) : cwd
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true })
  } catch {
    return results
  }

  for (const entry of entries) {
    if (FALLBACK_SKIP_DIRS.has(entry.name)) continue
    if (entry.name.startsWith('.')) continue

    const childRel = relDir ? `${relDir}/${entry.name}` : entry.name

    if (entry.isDirectory()) {
      results.push(...grepDir(cwd, childRel, query, opts))
    } else if (entry.isFile()) {
      const matcher = createFallbackMatcher(query, opts)
      const fullPath = path.join(cwd, childRel)
      try {
        const content = fs.readFileSync(fullPath, 'utf-8')
        if (/\0/.test(content)) continue
        const match = matcher(content, childRel)
        if (match) results.push(match)
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
): (content: string, relativePath: string) => FffGrepMatch | null {
  const flags = opts.smartCase && query === query.toLowerCase() ? 'gi' : 'g'
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  return (content: string, relativePath: string): FffGrepMatch | null => {
    const regex = new RegExp(escaped, flags)
    const match = regex.exec(content)
    if (!match) return null

    const lineStart = content.lastIndexOf('\n', match.index) + 1
    const lineEnd = content.indexOf('\n', match.index + match[0].length)
    const lineContent =
      lineEnd !== -1 ? content.slice(lineStart, lineEnd) : content.slice(lineStart)

    return {
      relativePath,
      fileName: path.basename(relativePath),
      lineNumber: content.slice(0, match.index).split('\n').length,
      lineContent,
      matchRanges: [[match.index - lineStart, match.index + match[0].length - lineStart]],
    }
  }
}
