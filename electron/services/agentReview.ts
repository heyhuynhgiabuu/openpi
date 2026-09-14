import fs from 'node:fs'
import path from 'node:path'
import type { BrowserWindow } from 'electron'
import { type AgentReviewChange, type AgentReviewSummary, IPC } from '../../src/lib/ipc'
import {
  readCurrentText,
  readSnapshot,
  resolveWorkspacePath,
  safeResolveWorkspacePath,
  type Snapshot,
} from './agentReviewFiles'
import {
  computeReviewHunks,
  createUnifiedDiff,
  keepHunkInBefore,
  revertHunkInAfter,
  type ReviewHunk,
} from './agentReviewDiff'

type PendingTool = {
  toolCallId: string
  toolName: string
  startedAt: number
  snapshots: Snapshot[]
}

type StoredChange = AgentReviewChange & {
  cwd: string
  beforeContent: string | null
  afterContent: string | null
  hunks: ReviewHunk[]
}

type ToolEvent = {
  type?: string
  toolCallId?: unknown
  toolName?: unknown
  args?: unknown
  result?: unknown
  isError?: unknown
}

const pendingTools = new Map<string, PendingTool>()
const changes = new Map<string, StoredChange>()
let mainWindow: BrowserWindow | null = null
let changeSequence = 0

export function setAgentReviewWindow(window: BrowserWindow | null): void {
  mainWindow = window
}

export function getAgentReviewSummary(cwd?: string | null): AgentReviewSummary {
  const items = [...changes.values()]
    .filter((change) => !cwd || change.cwd === cwd)
    .map(publicChange)
    .sort((a, b) => b.createdAt - a.createdAt)
  return { changes: items }
}

export function keepAgentReviewChange(id: string): AgentReviewSummary {
  changes.delete(id)
  emitChanged()
  return getAgentReviewSummary()
}

export function clearAgentReviewChanges(cwd?: string | null): AgentReviewSummary {
  for (const [id, change] of changes) {
    if (!cwd || change.cwd === cwd) changes.delete(id)
  }
  emitChanged(cwd)
  return getAgentReviewSummary(cwd)
}

export function revertAgentReviewChange(id: string): AgentReviewSummary {
  const change = changes.get(id)
  if (!change) return getAgentReviewSummary()

  validateRevert(change)
  applyRevert(change)

  changes.delete(id)
  emitChanged(change.cwd)
  return getAgentReviewSummary(change.cwd)
}

export function revertAgentReviewChanges(cwd?: string | null): AgentReviewSummary {
  const selected = [...changes.values()].filter((change) => !cwd || change.cwd === cwd)
  for (const change of selected) validateRevert(change)
  for (const change of selected) {
    applyRevert(change)
    changes.delete(change.id)
  }
  emitChanged(cwd)
  return getAgentReviewSummary(cwd)
}

/**
 * Accepts one hunk: the baseline adopts that hunk's lines, so it stops being
 * reported as a change. Nothing is written to disk — the file already holds it.
 */
export function keepAgentReviewHunk(id: string, index: number): AgentReviewSummary {
  const change = changes.get(id)
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
  const change = changes.get(id)
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
    changes.delete(change.id)
    return
  }
  const diff = createUnifiedDiff(change.path, beforeContent, afterContent)
  changes.set(change.id, {
    ...change,
    beforeContent,
    afterContent,
    diff: diff.text,
    totalAdded: diff.added,
    totalRemoved: diff.removed,
    truncated: diff.truncated,
    hunks: hunksFor('modified', diff.truncated, beforeContent, afterContent),
  })
}

function validateRevert(change: StoredChange): void {
  const fullPath = resolveWorkspacePath(change.cwd, change.path)
  const current = readCurrentText(fullPath)
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
  pendingTools.set(toolCallId, { toolCallId, toolName, startedAt: Date.now(), snapshots })
}

function captureToolEnd(cwd: string, toolCallId: string): void {
  const pending = pendingTools.get(toolCallId)
  if (!pending) return
  pendingTools.delete(toolCallId)

  let changed = false
  for (const snapshot of pending.snapshots) {
    if (snapshot.cwd !== cwd) continue
    const after = readSnapshot(snapshot.cwd, snapshot.relPath, snapshot.fullPath)
    if (after.skipped) continue
    const existing = findReviewChange(snapshot.cwd, snapshot.relPath)
    const before = existing?.beforeContent ?? snapshot.beforeContent
    const afterContent = after.beforeContent
    if (before === afterContent) {
      if (existing) {
        changes.delete(existing.id)
        changed = true
      }
      continue
    }
    if (!existing && snapshot.beforeContent === afterContent) continue

    const status = reviewStatus(before, afterContent)
    const diff = createUnifiedDiff(snapshot.relPath, before ?? '', afterContent ?? '')
    const id = existing?.id ?? `${Date.now()}-${changeSequence++}`
    changes.set(id, {
      id,
      cwd: snapshot.cwd,
      path: snapshot.relPath,
      toolCallId: pending.toolCallId,
      toolName: pending.toolName,
      status,
      createdAt: existing?.createdAt ?? Date.now(),
      beforeContent: before,
      afterContent,
      diff: diff.text,
      totalAdded: diff.added,
      totalRemoved: diff.removed,
      truncated: diff.truncated,
      hunks: hunksFor(status, diff.truncated, before, afterContent),
    })
    changed = true
  }

  if (changed) emitChanged(cwd)
}

function findReviewChange(cwd: string, relPath: string): StoredChange | null {
  return (
    [...changes.values()].find((change) => change.cwd === cwd && change.path === relPath) ?? null
  )
}

function reviewStatus(
  beforeContent: string | null,
  afterContent: string | null
): AgentReviewChange['status'] {
  if (beforeContent === null) return 'created'
  if (afterContent === null) return 'deleted'
  return 'modified'
}

/** Only modified files can be split into hunks; truncated diffs cannot be mapped to regions. */
function hunksFor(
  status: AgentReviewChange['status'],
  truncated: boolean,
  beforeContent: string | null,
  afterContent: string | null
): ReviewHunk[] {
  if (status !== 'modified' || truncated) return []
  return computeReviewHunks(beforeContent ?? '', afterContent ?? '')
}

function publicChange(change: StoredChange): AgentReviewChange {
  return {
    id: change.id,
    path: change.path,
    toolCallId: change.toolCallId,
    toolName: change.toolName,
    status: change.status,
    createdAt: change.createdAt,
    diff: change.diff,
    beforeContent: change.beforeContent,
    afterContent: change.afterContent,
    totalAdded: change.totalAdded,
    totalRemoved: change.totalRemoved,
    truncated: change.truncated,
    hunks: change.hunks.map((hunk) => ({
      index: hunk.index,
      beforeStart: hunk.beforeStart,
      afterStart: hunk.afterStart,
      added: hunk.added,
      removed: hunk.removed,
    })),
  }
}

function emitChanged(cwd?: string | null): void {
  mainWindow?.webContents.send(IPC.AGENT_REVIEW_CHANGED, getAgentReviewSummary(cwd))
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
