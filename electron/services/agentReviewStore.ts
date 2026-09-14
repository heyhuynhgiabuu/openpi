/**
 * Agent review store — Electron main process only.
 *
 * Owns the in-memory review items and the window that receives change
 * notifications. Capture and review actions go through these primitives, so the
 * store stays the only writer of review state.
 */
import type { BrowserWindow } from 'electron'
import { type AgentReviewChange, type AgentReviewSummary, IPC } from '../../src/lib/ipc'
import { computeReviewHunks, createUnifiedDiff, type ReviewHunk } from './agentReviewDiff'

export type StoredChange = AgentReviewChange & {
  cwd: string
  beforeContent: string | null
  afterContent: string | null
  hunks: ReviewHunk[]
}

/** Fields derived from a before/after pair, before they become a review item. */
interface ChangeContent {
  status: AgentReviewChange['status']
  diff: string
  totalAdded: number
  totalRemoved: number
  truncated: boolean
  hunks: ReviewHunk[]
}

const changes = new Map<string, StoredChange>()
let mainWindow: BrowserWindow | null = null
let changeSequence = 0

export function setAgentReviewWindow(window: BrowserWindow | null): void {
  mainWindow = window
}

export function nextChangeId(): string {
  return `${Date.now()}-${changeSequence++}`
}

export function findChange(cwd: string, relPath: string): StoredChange | null {
  return (
    [...changes.values()].find((change) => change.cwd === cwd && change.path === relPath) ?? null
  )
}

export function getChange(id: string): StoredChange | null {
  return changes.get(id) ?? null
}

export function putChange(change: StoredChange): void {
  changes.set(change.id, change)
}

export function removeChange(id: string): void {
  changes.delete(id)
}

export function listChanges(cwd?: string | null): StoredChange[] {
  return [...changes.values()].filter((change) => !cwd || change.cwd === cwd)
}

export function getAgentReviewSummary(cwd?: string | null): AgentReviewSummary {
  const items = listChanges(cwd)
    .map(publicChange)
    .sort((a, b) => b.createdAt - a.createdAt)
  return { changes: items }
}

export function emitChanged(cwd?: string | null): void {
  mainWindow?.webContents.send(IPC.AGENT_REVIEW_CHANGED, getAgentReviewSummary(cwd))
}

/**
 * Derives the diff fields for a before/after pair — the single place they are
 * computed, so a captured change and a hunk-level rewrite can never disagree.
 */
export function describeContent(
  filePath: string,
  beforeContent: string | null,
  afterContent: string | null
): ChangeContent {
  const status = reviewStatus(beforeContent, afterContent)
  const diff = createUnifiedDiff(filePath, beforeContent ?? '', afterContent ?? '')
  return {
    status,
    diff: diff.text,
    totalAdded: diff.added,
    totalRemoved: diff.removed,
    truncated: diff.truncated,
    hunks: hunksFor(status, diff.truncated, beforeContent, afterContent),
  }
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

/** Strips the hunk line payloads — the renderer only needs positions and counts. */
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
