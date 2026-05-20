/**
 * fffHost - long-lived FileFinder instance for the Electron main process.
 *
 * One singleton per workspace (cwd). Recreated when cwd changes.
 * Backed by @ff-labs/fff-node (Rust via ffi-rs): frecency-ranked fuzzy
 * file search + content grep - all in-process without subprocess spawning.
 */

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { FileFinder, FileItem, GrepMatch, GrepOptions, SearchOptions } from '@ff-labs/fff-node'
import { fallbackFileSearch, fallbackGrep } from './fffFallback'

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

export interface FffGrepOpts {
  mode?: 'plain' | 'regex' | 'fuzzy'
  smartCase?: boolean
  maxMatchesPerFile?: number
  timeBudgetMs?: number
  beforeContext?: number
  afterContext?: number
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
    ;({ FileFinder: FileFinderCtor } = await importFffNode())
  } catch (error) {
    // The native fff package can fail at import time in packaged apps (for
    // example quarantined/missing dylib). Keep currentCwd set so fileSearch can
    // still use the filesystem fallback instead of making the renderer show an
    // unhelpful permanent "No files match" state.
    console.error('[fffHost] @ff-labs/fff-node import failed:', error)
    return
  }

  let result: ReturnType<typeof FileFinderCtor.create>
  try {
    result = FileFinderCtor.create({
      basePath: cwd,
      aiMode: false,
      disableWatch: false, // watch FS for changes
    })
  } catch (error) {
    console.error('[fffHost] FileFinder.create threw:', error)
    return
  }

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

async function importFffNode(): Promise<typeof import('@ff-labs/fff-node')> {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  if (resourcesPath) {
    const unpackedEntry = path.join(
      resourcesPath,
      'app.asar.unpacked',
      'node_modules',
      '@ff-labs',
      'fff-node',
      'dist',
      'src',
      'index.js'
    )
    if (fs.existsSync(unpackedEntry)) {
      return import(pathToFileURL(unpackedEntry).href) as Promise<
        typeof import('@ff-labs/fff-node')
      >
    }
  }

  return import('@ff-labs/fff-node')
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

function grepMatchToResult(m: GrepMatch): FffGrepMatch {
  return {
    relativePath: m.relativePath,
    fileName: m.fileName,
    lineNumber: m.lineNumber,
    lineContent: m.lineContent,
    matchRanges: m.matchRanges,
  }
}

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
