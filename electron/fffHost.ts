/**
 * fffHost - long-lived FileFinder instance for the Electron main process.
 *
 * One singleton per workspace (cwd). Recreated when cwd changes.
 * Backed by @ff-labs/fff-node (Rust via ffi-rs): frecency-ranked fuzzy
 * file search + content grep - all in-process without subprocess spawning.
 */

import fs from 'node:fs'
import path from 'node:path'
import type { FileFinder, FileItem, GrepMatch, GrepOptions, SearchOptions } from '@ff-labs/fff-node'

// ─── Exported result shapes (IPC-safe, lean) ──────────────────────────────────

export interface FffFileResult {
  relativePath: string
  fileName: string
  /** dirname of relativePath, e.g. "src/components" */
  dir: string
}

export interface FffGrepMatch {
  relativePath: string
  fileName: string
  /** 1-based line number */
  lineNumber: number
  lineContent: string
  /** [start, end] byte-offset pairs within lineContent */
  matchRanges: [number, number][]
}

// ─── Singleton state ──────────────────────────────────────────────────────────

let finder: FileFinder | null = null
let currentCwd: string | null = null
let scanPromise: Promise<unknown> | null = null

// ─── Init / teardown ──────────────────────────────────────────────────────────

/**
 * Initialize (or re-initialize) the FileFinder for `cwd`.
 * Safe to call multiple times - no-op if cwd hasn't changed.
 * Background scan starts immediately; searches work before it completes
 * (may return fewer results initially).
 */
export async function initFff(cwd: string): Promise<void> {
  if (currentCwd === cwd && finder) return

  // Destroy previous instance
  destroyFff()
  currentCwd = cwd

  let FileFinderCtor: typeof FileFinder
  try {
    ;({ FileFinder: FileFinderCtor } = await import('@ff-labs/fff-node'))
  } catch (error) {
    // The native fff package can fail at import time in packaged apps (for
    // example quarantined/missing dylib). Keep currentCwd set so fileSearch can
    // still use the filesystem fallback instead of making the renderer show an
    // unhelpful permanent "No files match" state.
    console.error('[fffHost] @ff-labs/fff-node import failed:', error)
    return
  }

  const result = FileFinderCtor.create({
    basePath: cwd,
    aiMode: false,
    disableWatch: false, // watch FS for changes
  })

  if (!result.ok) {
    console.error('[fffHost] FileFinder.create failed:', result.error)
    return
  }

  finder = result.value

  // Start scan in background — don’t block workspace/session startup.
  // Search calls await this briefly so the first @ query doesn't race the
  // cold scanner and permanently render "No files match" until the user types
  // again.
  scanPromise = finder.waitForScan(30_000).catch((e: unknown) => {
    console.warn('[fffHost] scan timed out or errored:', e)
  })

  console.log('[fffHost] initialized for', cwd)
}

export function destroyFff(): void {
  if (finder) {
    try {
      finder.destroy()
    } catch {}
    finder = null
  }
  scanPromise = null
  currentCwd = null
}

// ─── File search ──────────────────────────────────────────────────────────────

/**
 * Frecency-ranked fuzzy file search.
 * Empty query returns all indexed files sorted by frecency.
 */
export async function fffFileSearch(query: string, pageSize = 80): Promise<FffFileResult[]> {
  const cwd = currentCwd
  if (!finder || !cwd) return fallbackFileSearch(cwd, query, pageSize)
  try {
    await waitForInitialScan(1200)
    const opts: SearchOptions = { pageSize }
    const result = finder.fileSearch(query, opts)
    if (!result.ok) return fallbackFileSearch(cwd, query, pageSize)
    const items = result.value.items.map(fileItemToResult)
    return items.length > 0 ? items : fallbackFileSearch(cwd, query, pageSize)
  } catch (e) {
    console.warn('[fffHost] fileSearch error:', e)
    return fallbackFileSearch(cwd, query, pageSize)
  }
}

async function waitForInitialScan(timeoutMs: number): Promise<void> {
  if (!scanPromise) return
  await Promise.race([scanPromise, new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))])
}

function fileItemToResult(item: FileItem): FffFileResult {
  const idx = item.relativePath.lastIndexOf('/')
  const dir = idx >= 0 ? item.relativePath.slice(0, idx) : ''
  return { relativePath: item.relativePath, fileName: item.fileName, dir }
}

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

function fallbackFileSearch(cwd: string | null, query: string, pageSize: number): FffFileResult[] {
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
      if (visited++ >= maxVisited) break
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (!FALLBACK_SKIP_DIRS.has(entry.name)) stack.push(relPath)
        continue
      }
      if (!entry.isFile()) continue

      const score = fallbackScore(relPath, entry.name, normalizedQuery)
      if (score == null) continue
      hits.push({ relativePath: relPath, fileName: entry.name, dir: relDir, score })
    }
  }

  return hits
    .sort((a, b) => b.score - a.score || a.relativePath.localeCompare(b.relativePath))
    .slice(0, pageSize)
    .map(({ score: _score, ...item }) => item)
}

function fallbackScore(relativePath: string, fileName: string, query: string): number | null {
  if (!query) return 1
  const name = fileName.toLowerCase()
  const full = relativePath.toLowerCase()
  if (name === query) return 1000
  if (name.startsWith(query)) return 900 - name.length
  if (name.includes(query)) return 700 - name.indexOf(query)
  if (full.includes(query)) return 500 - full.indexOf(query)

  let qi = 0
  for (let i = 0; i < full.length && qi < query.length; i += 1) {
    if (full[i] === query[qi]) qi += 1
  }
  return qi === query.length ? 250 - full.length : null
}

// ─── Content grep ─────────────────────────────────────────────────────────────

export interface FffGrepOpts {
  mode?: 'plain' | 'regex' | 'fuzzy'
  /** false = always case-sensitive; true = smart case (default) */
  smartCase?: boolean
  maxMatchesPerFile?: number
  timeBudgetMs?: number
  beforeContext?: number
  afterContext?: number
}

/**
 * Content grep with three modes: plain (SIMD memmem), regex, fuzzy (Smith-Waterman).
 * Returns up to `maxMatchesPerFile` matches per file, with optional context lines.
 */
export async function fffGrep(query: string, opts: FffGrepOpts = {}): Promise<FffGrepMatch[]> {
  const cwd = currentCwd
  if (!query.trim()) return []
  if (!finder || !cwd) return fallbackGrep(cwd, query, opts)
  try {
    await waitForInitialScan(1200)
    const grepOpts: GrepOptions = {
      mode: opts.mode ?? 'plain',
      smartCase: opts.smartCase ?? true,
      maxMatchesPerFile: opts.maxMatchesPerFile ?? 5,
      timeBudgetMs: opts.timeBudgetMs ?? 3000,
      beforeContext: opts.beforeContext ?? 0,
      afterContext: opts.afterContext ?? 0,
    }
    const result = finder.grep(query, grepOpts)
    if (!result.ok) return fallbackGrep(cwd, query, opts)
    const items = result.value.items.map(grepMatchToResult)
    return items.length > 0 ? items : fallbackGrep(cwd, query, opts)
  } catch (e) {
    console.warn('[fffHost] grep error:', e)
    return fallbackGrep(cwd, query, opts)
  }
}

function fallbackGrep(cwd: string | null, query: string, opts: FffGrepOpts): FffGrepMatch[] {
  if (!cwd || !query.trim()) return []
  const started = Date.now()
  const timeBudgetMs = opts.timeBudgetMs ?? 3000
  const maxMatchesPerFile = opts.maxMatchesPerFile ?? 5
  const mode = opts.mode ?? 'plain'
  const matcher = createFallbackMatcher(query, mode, opts.smartCase ?? true)
  if (!matcher) return []

  const matches: FffGrepMatch[] = []
  for (const file of fallbackFileSearch(cwd, '', 8000)) {
    if (Date.now() - started > timeBudgetMs) break
    const absolutePath = path.join(cwd, file.relativePath)
    let content: string
    try {
      const stat = fs.statSync(absolutePath)
      if (!stat.isFile() || stat.size > 2_000_000) continue
      const raw = fs.readFileSync(absolutePath)
      if (raw.includes(0)) continue
      content = raw.toString('utf8')
    } catch {
      continue
    }

    let perFile = 0
    const lines = content.split(/\r?\n/)
    for (let i = 0; i < lines.length; i += 1) {
      const ranges = matcher(lines[i])
      if (ranges.length === 0) continue
      matches.push({
        relativePath: file.relativePath,
        fileName: file.fileName,
        lineNumber: i + 1,
        lineContent: lines[i],
        matchRanges: ranges,
      })
      perFile += 1
      if (perFile >= maxMatchesPerFile) break
    }
  }
  return matches
}

function createFallbackMatcher(
  query: string,
  mode: 'plain' | 'regex' | 'fuzzy',
  smartCase: boolean
): ((line: string) => [number, number][]) | null {
  if (mode === 'regex') {
    try {
      const flags = smartCase && query === query.toLowerCase() ? 'gi' : 'g'
      const re = new RegExp(query, flags)
      return (line) => {
        const ranges: [number, number][] = []
        re.lastIndex = 0
        let match = re.exec(line)
        while (match) {
          ranges.push([match.index, match.index + match[0].length])
          if (match[0].length === 0) re.lastIndex += 1
          match = re.exec(line)
        }
        return ranges
      }
    } catch {
      return null
    }
  }

  const needle = smartCase && query === query.toLowerCase() ? query.toLowerCase() : query
  const fold = smartCase && query === query.toLowerCase()
  return (line) => {
    const haystack = fold ? line.toLowerCase() : line
    const index = haystack.indexOf(needle)
    return index >= 0 ? [[index, index + needle.length]] : []
  }
}

function grepMatchToResult(m: GrepMatch): FffGrepMatch {
  return {
    relativePath: m.relativePath,
    fileName: m.fileName,
    lineNumber: m.lineNumber,
    lineContent: m.lineContent,
    matchRanges: m.matchRanges,
  }
}
