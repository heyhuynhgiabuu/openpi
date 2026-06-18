import fs from 'node:fs'
import path from 'node:path'
import type { BrowserWindow } from 'electron'
import { type AgentReviewChange, type AgentReviewSummary, IPC } from '../../src/lib/ipc'

const MAX_REVIEW_FILE_BYTES = 500_000
const MAX_DIFF_LINES = 700
const MAX_DIFF_LINE_LENGTH = 2_000
const MAX_DIFF_CELLS = 250_000

type Snapshot = {
  cwd: string
  relPath: string
  fullPath: string
  beforeContent: string | null
  beforeExists: boolean
  skipped?: string
}

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

function validateRevert(change: StoredChange): void {
  const fullPath = resolveWorkspacePath(change.cwd, change.path)
  const current = readCurrentText(fullPath)
  if (current.skipped) throw new Error(current.skipped)
  if (current.content !== change.afterContent) {
    throw new Error(`Refusing to revert ${change.path}: file changed since review item was created`)
  }
}

function applyRevert(change: StoredChange): void {
  const fullPath = resolveWorkspacePath(change.cwd, change.path)
  if (change.beforeContent === null) {
    if (fs.existsSync(fullPath)) fs.rmSync(fullPath, { force: true })
  } else {
    fs.mkdirSync(path.dirname(fullPath), { recursive: true })
    fs.writeFileSync(fullPath, change.beforeContent, 'utf-8')
  }
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
  }
}

function emitChanged(cwd?: string | null): void {
  mainWindow?.webContents.send(IPC.AGENT_REVIEW_CHANGED, getAgentReviewSummary(cwd))
}

function safeResolveWorkspacePath(
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

function resolveWorkspacePath(cwd: string, relPath: string): string {
  const resolved = safeResolveWorkspacePath(cwd, relPath)
  if (!resolved) throw new Error(`Invalid review path: ${relPath}`)
  return resolved.fullPath
}

function readSnapshot(cwd: string, relPath: string, fullPath: string): Snapshot {
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

function readCurrentText(fullPath: string): {
  exists: boolean
  content: string | null
  skipped?: string
} {
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

function createUnifiedDiff(
  filePath: string,
  beforeContent: string,
  afterContent: string
): { text: string; added: number; removed: number; truncated: boolean } {
  const before = beforeContent.split('\n')
  const after = afterContent.split('\n')
  let truncated = false
  let diffLines: string[]

  if (before.length * after.length > MAX_DIFF_CELLS) {
    truncated = true
    diffLines = [
      `--- ${filePath}`,
      `+++ ${filePath}`,
      `@@ large file diff omitted; ${before.length} → ${after.length} lines @@`,
    ]
  } else {
    diffLines = [`--- ${filePath}`, `+++ ${filePath}`, '@@ snapshot diff @@']
    for (const line of lineDiff(before, after)) {
      const safeText =
        line.text.length > MAX_DIFF_LINE_LENGTH
          ? `${line.text.slice(0, MAX_DIFF_LINE_LENGTH)}…`
          : line.text
      diffLines.push(`${line.kind}${safeText}`)
      if (diffLines.length >= MAX_DIFF_LINES) {
        truncated = true
        diffLines.push('… diff truncated …')
        break
      }
    }
  }

  const added = diffLines.filter((line) => line.startsWith('+') && !line.startsWith('+++')).length
  const removed = diffLines.filter((line) => line.startsWith('-') && !line.startsWith('---')).length
  return { text: diffLines.join('\n'), added, removed, truncated }
}

function lineDiff(
  before: string[],
  after: string[]
): Array<{ kind: ' ' | '+' | '-'; text: string }> {
  const rows = before.length + 1
  const cols = after.length + 1
  const dp = Array.from({ length: rows }, () => new Uint16Array(cols))
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      dp[i][j] =
        before[i] === after[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const output: Array<{ kind: ' ' | '+' | '-'; text: string }> = []
  let i = 0
  let j = 0
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      output.push({ kind: ' ', text: before[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      output.push({ kind: '-', text: before[i] })
      i++
    } else {
      output.push({ kind: '+', text: after[j] })
      j++
    }
  }
  while (i < before.length) output.push({ kind: '-', text: before[i++] })
  while (j < after.length) output.push({ kind: '+', text: after[j++] })
  return output
}
