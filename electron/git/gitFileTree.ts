/**
 * gitFileTree.ts — File tree and directory watching.
 * Extracted from gitHost.ts.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import type { FileTreeNode, FileTreeResult } from '../../src/lib/ipc'

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
      return a.name.localeCompare(b.name)
    })) {
    if (budget.remaining <= 0) break
    const childRel = relPath ? `${relPath}/${entry.name}` : entry.name
    budget.remaining--

    if (entry.isDirectory()) {
      const children = readDirEntries(cwd, childRel, depth - 1, budget)
      nodes.push({ name: entry.name, path: childRel, isDir: true, children })
    } else {
      nodes.push({ name: entry.name, path: childRel, isDir: false })
    }
  }
  return nodes
}

export function getFileTree(cwd: string): FileTreeResult {
  const budget = { remaining: MAX_FILE_TREE_NODES }
  const children = readDirEntries(cwd, '', MAX_FILE_TREE_DEPTH, budget)
  return { rootName: path.basename(cwd), children }
}

export function startFileTreeWatch(cwd: string, onChange: () => void): void {
  stopFileTreeWatch()
  try {
    fileTreeWatcher = fs.watch(cwd, { recursive: true }, (_eventType, filename) => {
      if (shouldIgnoreFileTreeEvent(filename)) return
      if (fileTreeWatchTimer) clearTimeout(fileTreeWatchTimer)
      fileTreeWatchTimer = setTimeout(onChange, FILE_TREE_WATCH_DEBOUNCE_MS)
    })
  } catch {
    fileTreeWatcher = fs.watch(cwd, (_eventType, filename) => {
      if (shouldIgnoreFileTreeEvent(filename)) return
      if (fileTreeWatchTimer) clearTimeout(fileTreeWatchTimer)
      fileTreeWatchTimer = setTimeout(onChange, FILE_TREE_WATCH_DEBOUNCE_MS)
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

/** Enrich a file tree with git status changeType markers. */
export function enrichTree(tree: FileTreeResult, statusMap: Map<string, string>): FileTreeResult {
  return {
    ...tree,
    children: tree.children.map((child) => enrichNode(child, statusMap)),
  }
}

function enrichNode(node: FileTreeNode, statusMap: Map<string, string>): FileTreeNode {
  const changeType = statusMap.get(node.path) as 'M' | 'A' | 'D' | 'R' | undefined
  return {
    ...node,
    changeType,
    children: node.children?.map((child) => enrichNode(child, statusMap)),
  }
}
