/**
 * File access for agent review snapshots — Electron main process only.
 *
 * Every path is resolved against the workspace root and rejected when it
 * escapes, so review can never be pointed at an arbitrary file.
 */
import fs from 'node:fs'
import path from 'node:path'

const MAX_REVIEW_FILE_BYTES = 500_000

export type Snapshot = {
  cwd: string
  relPath: string
  fullPath: string
  beforeContent: string | null
  beforeExists: boolean
  skipped?: string
}

export function safeResolveWorkspacePath(
  cwd: string,
  candidate: string
): { relPath: string; fullPath: string } | null {
  const raw = candidate.trim()
  if (!raw || raw === '.' || raw.includes('\0')) return null
  const fullPath = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(cwd, raw)
  const resolvedCwd = path.resolve(cwd)
  if (fullPath !== resolvedCwd && !fullPath.startsWith(resolvedCwd + path.sep)) return null
  const relPath = path.relative(resolvedCwd, fullPath).split(path.sep).join('/')
  if (!relPath || relPath.startsWith('..')) return null
  return { relPath, fullPath }
}

export function resolveWorkspacePath(cwd: string, relPath: string): string {
  const resolved = safeResolveWorkspacePath(cwd, relPath)
  if (!resolved) throw new Error(`Invalid review path: ${relPath}`)
  return resolved.fullPath
}

export function readSnapshot(cwd: string, relPath: string, fullPath: string): Snapshot {
  const current = readCurrentText(fullPath)
  return {
    cwd,
    relPath,
    fullPath,
    beforeContent: current.content,
    beforeExists: current.exists,
    skipped: current.skipped,
  }
}

export interface CurrentText {
  exists: boolean
  content: string | null
  /** Set when the file exists but review cannot read it (binary, too large, not a file). */
  skipped?: string
}

export function readCurrentText(fullPath: string): CurrentText {
  if (!fs.existsSync(fullPath)) return { exists: false, content: null }
  const stat = fs.statSync(fullPath)
  if (!stat.isFile()) return { exists: true, content: null, skipped: 'Review supports files only' }
  if (stat.size > MAX_REVIEW_FILE_BYTES) {
    return { exists: true, content: null, skipped: 'Review skipped a large file' }
  }
  const buffer = fs.readFileSync(fullPath)
  if (buffer.includes(0))
    return { exists: true, content: null, skipped: 'Review skipped a binary file' }
  return { exists: true, content: buffer.toString('utf-8') }
}
