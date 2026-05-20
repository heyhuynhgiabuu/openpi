/**
 * gitSearch.ts — File content search by walking the filesystem.
 *
 * Extracted from gitHost.ts. Walks the working tree respecting IGNORED_DIRS.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ContentMatch, FileContentHit } from '../../src/lib/ipc'

// ─── Constants ─────────────────────────────────────────────────────────────

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  '.next',
  'dist',
  'build',
  '.cache',
  '.pi',
  '.beads',
])

const BINARY_PATTERN = /\0/
const MAX_FILE_SIZE = 1_000_000
const MAX_FILE_HITS = 50
const MAX_LINE_HITS = 5

// ─── Helpers ───────────────────────────────────────────────────────────────

function escapeRegexMain(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

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

// ─── Search ────────────────────────────────────────────────────────────────

export function searchFileContents(
  cwd: string,
  query: string,
  matchCase: boolean,
  wholeWord: boolean,
  useRegex: boolean
): FileContentHit[] {
  if (!query.trim()) return []

  let regex: RegExp
  try {
    let pattern = useRegex ? query : escapeRegexMain(query)
    if (wholeWord) pattern = `\\b${pattern}\\b`
    const flags = matchCase ? 'g' : 'gi'
    regex = new RegExp(pattern, flags)
  } catch {
    return []
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
