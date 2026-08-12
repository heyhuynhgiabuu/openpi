/**
 * Helpers for `@heyhuynhgiabuu/pi-task` JSON state under `.pi/`.
 *
 * Canonical layout:
 *   .pi/artifacts/task-sessions.json               — conversation_id → { task_id }
 *   .pi/artifacts/tasks/sessions/<taskId>/*.jsonl  — sub-session created by a task
 *   .pi/task-session-history.json                  — task status/session metadata
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  findTaskIdForToolCall,
  MAX_TIME_DELTA_MS,
  type TaskHistoryEntry,
} from '../../src/lib/taskHistory'
import { normalizeTaskHistoryStatus } from './piTaskStatus'
import { readWorkspaceFile, resolveWorkspacePath } from './workspacePath'

export type { TaskHistoryEntry }
export { findTaskIdForToolCall, MAX_TIME_DELTA_MS }

export const PI_TASK_SHORT_ID = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,80}$/

export function getSubSessionDir(artifactsDir: string, taskId: string): string {
  return path.join(artifactsDir, 'tasks', 'sessions', taskId)
}

function findSessionFile(workspace: string, submittedDir: string): string | null {
  let entries: string[]
  let dir: string
  try {
    dir = resolveWorkspacePath(
      workspace,
      path.relative(workspace, submittedDir),
      'resolve task session'
    )
    if (!fs.lstatSync(dir).isDirectory()) return null
    entries = fs.readdirSync(dir)
  } catch {
    return null
  }
  const file = entries.find((name) => {
    if (!name.endsWith('.jsonl')) return false
    try {
      return fs.lstatSync(path.join(dir, name)).isFile()
    } catch {
      return false
    }
  })
  return file ? path.join(dir, file) : null
}

export function resolveSubSessionPath(artifactsDir: string, taskId: string): string | null {
  if (!PI_TASK_SHORT_ID.test(taskId)) return null
  const historyPath = resolveHistorySessionRef(artifactsDir, taskId)
  if (historyPath !== null) return historyPath

  const workspace = path.dirname(path.dirname(artifactsDir))
  return (
    findSessionFile(workspace, getSubSessionDir(artifactsDir, taskId)) ??
    findSessionFile(workspace, path.join(artifactsDir, 'sessions', taskId))
  )
}

function resolveHistorySessionRef(artifactsDir: string, taskId: string): string | null {
  const workspace = path.dirname(path.dirname(artifactsDir))
  const file = resolveWorkspacePath(workspace, '.pi/task-session-history.json', 'read task history')
  let raw: string
  try {
    raw = readWorkspaceFile(file, workspace)
  } catch {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) return null
  const match = parsed.find((entry): entry is TaskHistoryEntry => {
    if (entry === null || typeof entry !== 'object') return false
    return 'id' in entry && entry.id === taskId
  })
  const sessionRef = match?.sessionRef
  if (typeof sessionRef !== 'string' || sessionRef.length === 0) return null
  const submittedCandidate = path.isAbsolute(sessionRef)
    ? sessionRef
    : path.join(artifactsDir, sessionRef)
  try {
    const candidate = resolveWorkspacePath(
      workspace,
      path.relative(workspace, submittedCandidate),
      'resolve task session'
    )
    const stat = fs.lstatSync(candidate)
    return stat.isFile() ? candidate : null
  } catch {
    return null
  }
}

export function resolveMostRecentSubSessionPath(artifactsDir: string): string | null {
  const submittedRoots = [
    path.join(artifactsDir, 'tasks', 'sessions'),
    path.join(artifactsDir, 'sessions'),
  ]
  const workspace = path.dirname(path.dirname(artifactsDir))
  let best: { file: string; mtimeMs: number } | null = null
  for (const submittedRoot of submittedRoots) {
    let taskDirs: string[]
    let root: string
    try {
      root = resolveWorkspacePath(
        workspace,
        path.relative(workspace, submittedRoot),
        'resolve task session'
      )
      if (!fs.lstatSync(root).isDirectory()) continue
      taskDirs = fs.readdirSync(root)
    } catch {
      continue
    }
    for (const taskId of taskDirs) {
      if (!PI_TASK_SHORT_ID.test(taskId)) continue
      let dir: string
      let files: string[]
      try {
        dir = resolveWorkspacePath(
          workspace,
          path.relative(workspace, path.join(root, taskId)),
          'resolve task session'
        )
        if (!fs.lstatSync(dir).isDirectory()) continue
        files = fs.readdirSync(dir)
      } catch {
        continue
      }
      for (const name of files) {
        if (!name.endsWith('.jsonl')) continue
        try {
          const file = resolveWorkspacePath(
            workspace,
            path.relative(workspace, path.join(dir, name)),
            'resolve task session'
          )
          const stat = fs.lstatSync(file)
          if (stat.isFile() && (best === null || stat.mtimeMs > best.mtimeMs)) {
            best = { file, mtimeMs: stat.mtimeMs }
          }
        } catch {}
      }
    }
  }
  return best?.file ?? null
}

export function readTaskSessionHistory(cwd: string): TaskHistoryEntry[] {
  let raw: string
  try {
    const file = resolveWorkspacePath(cwd, '.pi/task-session-history.json', 'read task history')
    raw = readWorkspaceFile(file, cwd)
  } catch {
    return []
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const out: TaskHistoryEntry[] = []
  for (const entry of parsed) {
    if (entry && typeof entry === 'object' && typeof (entry as TaskHistoryEntry).id === 'string') {
      const historyEntry = entry as TaskHistoryEntry
      out.push({
        ...historyEntry,
        status: normalizeTaskHistoryStatus(
          cwd,
          historyEntry.id,
          historyEntry.status,
          historyEntry.paneId
        ),
      })
    }
  }
  return out
}
