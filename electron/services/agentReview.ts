/**
 * Agent review capture and actions — Electron main process only.
 *
 * Capture snapshots files around Pi tool calls; actions accept or revert a
 * review item, either whole-file or per hunk. State lives in agentReviewStore.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { AgentReviewSummary } from '../../src/lib/ipc'
import { keepHunkInBefore, revertHunkInAfter, type ReviewHunk } from './agentReviewDiff'
import {
  readCurrentText,
  readSnapshot,
  resolveWorkspacePath,
  safeResolveWorkspacePath,
  type Snapshot,
} from './agentReviewFiles'
import {
  describeContent,
  emitChanged,
  findChange,
  getAgentReviewSummary,
  getChange,
  listChanges,
  nextChangeId,
  putChange,
  removeChange,
  type StoredChange,
} from './agentReviewStore'

type PendingTool = {
  toolCallId: string
  toolName: string
  snapshots: Snapshot[]
}

type ToolEvent = {
  type?: string
  toolCallId?: unknown
  toolName?: unknown
  args?: unknown
}

const pendingTools = new Map<string, PendingTool>()

export function keepAgentReviewChange(id: string): AgentReviewSummary {
  removeChange(id)
  emitChanged()
  return getAgentReviewSummary()
}

export function clearAgentReviewChanges(cwd?: string | null): AgentReviewSummary {
  for (const change of listChanges(cwd)) removeChange(change.id)
  emitChanged(cwd)
  return getAgentReviewSummary(cwd)
}

export function revertAgentReviewChange(id: string): AgentReviewSummary {
  const change = getChange(id)
  if (!change) return getAgentReviewSummary()

  validateRevert(change)
  applyRevert(change)

  removeChange(id)
  emitChanged(change.cwd)
  return getAgentReviewSummary(change.cwd)
}

export function revertAgentReviewChanges(cwd?: string | null): AgentReviewSummary {
  const selected = listChanges(cwd)
  for (const change of selected) validateRevert(change)
  for (const change of selected) {
    applyRevert(change)
    removeChange(change.id)
  }
  emitChanged(cwd)
  return getAgentReviewSummary(cwd)
}

/**
 * Accepts one hunk: the baseline adopts that hunk's lines, so it stops being
 * reported as a change. Nothing is written to disk — the file already holds it.
 */
export function keepAgentReviewHunk(id: string, index: number): AgentReviewSummary {
  const change = getChange(id)
  if (!change) return getAgentReviewSummary()
  const hunk = selectHunk(change, index)

  storeReviewedContent(
    change,
    keepHunkInBefore(change.beforeContent ?? '', hunk),
    change.afterContent ?? ''
  )
  emitChanged(change.cwd)
  return getAgentReviewSummary(change.cwd)
}

/** Rejects one hunk: its before lines go back into the file on disk. */
export function revertAgentReviewHunk(id: string, index: number): AgentReviewSummary {
  const change = getChange(id)
  if (!change) return getAgentReviewSummary()
  const hunk = selectHunk(change, index)

  validateRevert(change)
  const afterContent = revertHunkInAfter(change.afterContent ?? '', hunk)
  writeReviewedContent(change, afterContent)

  storeReviewedContent(change, change.beforeContent ?? '', afterContent)
  emitChanged(change.cwd)
  return getAgentReviewSummary(change.cwd)
}

/**
 * Hunk review applies to modified files only. Created and deleted files are
 * reviewed as a whole: keeping part of a new file would silently turn its
 * "revert" into "empty the file" instead of "delete it".
 */
function selectHunk(change: StoredChange, index: number): ReviewHunk {
  if (change.status !== 'modified') {
    throw new Error(
      `Refusing hunk review for ${change.path}: ${change.status} files are whole-file`
    )
  }
  if (change.truncated) {
    throw new Error(`Refusing hunk review for ${change.path}: diff is too large to split`)
  }
  const hunk = change.hunks[index]
  if (!hunk) throw new Error(`Unknown hunk ${index} for ${change.path}`)
  return hunk
}

/** Rewrites the stored change from new content, dropping it once nothing is left to review. */
function storeReviewedContent(
  change: StoredChange,
  beforeContent: string,
  afterContent: string
): void {
  if (beforeContent === afterContent) {
    removeChange(change.id)
    return
  }
  putChange({
    ...change,
    beforeContent,
    afterContent,
    ...describeContent(change.path, beforeContent, afterContent),
  })
}

function validateRevert(change: StoredChange): void {
  const fullPath = resolveWorkspacePath(change.cwd, change.path)
  const current = readCurrentText(fullPath, change.cwd)
  if (current.skipped) throw new Error(current.skipped)
  if (current.content !== change.afterContent) {
    throw new Error(`Refusing to revert ${change.path}: file changed since review item was created`)
  }
}

function applyRevert(change: StoredChange): void {
  if (change.beforeContent === null) {
    const fullPath = resolveWorkspacePath(change.cwd, change.path)
    if (fs.existsSync(fullPath)) fs.rmSync(fullPath, { force: true })
    return
  }
  writeReviewedContent(change, change.beforeContent)
}

function writeReviewedContent(change: StoredChange, content: string): void {
  const fullPath = resolveWorkspacePath(change.cwd, change.path)
  fs.mkdirSync(path.dirname(fullPath), { recursive: true })
  fs.writeFileSync(fullPath, content, 'utf-8')
}

export function captureAgentReviewEvent(cwd: string | null, event: ToolEvent): void {
  if (!cwd || typeof event.toolCallId !== 'string' || typeof event.toolName !== 'string') return
  if (event.type === 'tool_execution_start') {
    captureToolStart(cwd, event.toolCallId, event.toolName, event.args)
  } else if (event.type === 'tool_execution_end') {
    captureToolEnd(cwd, event.toolCallId)
  }
}

function captureToolStart(cwd: string, toolCallId: string, toolName: string, args: unknown): void {
  const paths = extractMutablePaths(toolName, args)
  if (paths.length === 0) return

  const snapshots: Snapshot[] = []
  const seen = new Set<string>()
  for (const candidate of paths) {
    const resolved = safeResolveWorkspacePath(cwd, candidate)
    if (!resolved || seen.has(resolved.relPath)) continue
    seen.add(resolved.relPath)
    const snapshot = readSnapshot(cwd, resolved.relPath, resolved.fullPath)
    if (!snapshot.skipped) snapshots.push(snapshot)
  }
  if (snapshots.length === 0) return
  pendingTools.set(toolCallId, { toolCallId, toolName, snapshots })
}

function captureToolEnd(cwd: string, toolCallId: string): void {
  const pending = pendingTools.get(toolCallId)
  if (!pending) return
  pendingTools.delete(toolCallId)

  let changed = false
  for (const snapshot of pending.snapshots) {
    if (snapshot.cwd !== cwd) continue
    // Re-resolve before the second read: between the two events the path can be
    // replaced by a symlink, and the review must not pull in outside content.
    const resolved = safeResolveWorkspacePath(snapshot.cwd, snapshot.relPath)
    if (!resolved) continue
    const after = readSnapshot(snapshot.cwd, resolved.relPath, resolved.fullPath)
    if (after.skipped) continue
    const existing = findChange(snapshot.cwd, snapshot.relPath)
    const before = existing?.beforeContent ?? snapshot.beforeContent
    const afterContent = after.beforeContent
    if (before === afterContent) {
      if (existing) {
        removeChange(existing.id)
        changed = true
      }
      continue
    }
    putChange({
      id: existing?.id ?? nextChangeId(),
      cwd: snapshot.cwd,
      path: snapshot.relPath,
      toolCallId: pending.toolCallId,
      toolName: pending.toolName,
      createdAt: existing?.createdAt ?? Date.now(),
      beforeContent: before,
      afterContent,
      ...describeContent(snapshot.relPath, before, afterContent),
    })
    changed = true
  }

  if (changed) emitChanged(cwd)
}

function extractMutablePaths(toolName: string, args: unknown): string[] {
  const name = toolName.toLowerCase()
  if (!args || typeof args !== 'object') return []
  const record = args as Record<string, unknown>
  const paths: string[] = []
  addString(paths, record.path)
  addString(paths, record.file_path)
  addString(paths, record.filePath)

  if (name === 'apply_patch' || name === 'patch') {
    addPatchPaths(paths, record.patch)
    addPatchPaths(paths, record.content)
    addPatchPaths(paths, record.input)
    addPatchPaths(paths, record.command)
  }

  if (
    name.includes('edit') ||
    name === 'write' ||
    name === 'strreplace' ||
    name === 'str_replace'
  ) {
    addString(paths, record.target_file)
    addString(paths, record.targetPath)
  }

  return [...new Set(paths)]
}

function addString(paths: string[], value: unknown): void {
  if (typeof value === 'string' && value.trim()) paths.push(value.trim())
}

function addPatchPaths(paths: string[], value: unknown): void {
  if (typeof value !== 'string') return
  for (const line of value.split('\n')) {
    const trimmed = line.trimEnd()
    const markerMatch = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/.exec(trimmed)
    if (markerMatch) {
      paths.push(markerMatch[1])
      continue
    }
    const gitMatch = /^(?:---|\+\+\+)\s+(?:a\/|b\/)?(.+)$/.exec(trimmed)
    if (gitMatch && gitMatch[1] !== '/dev/null') paths.push(gitMatch[1])
  }
}
