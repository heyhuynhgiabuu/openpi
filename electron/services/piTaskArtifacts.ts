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

export type { TaskHistoryEntry }
export { findTaskIdForToolCall, MAX_TIME_DELTA_MS }

export const PI_TASK_SHORT_ID = /^[A-Za-z0-9._-]{1,80}$/

export function getSubSessionDir(artifactsDir: string, taskId: string): string {
  return path.join(artifactsDir, 'tasks', 'sessions', taskId)
}

function findSessionFile(dir: string): string | null {
  let entries: string[]
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return null
  }
  const file = entries.find((name) => name.endsWith('.jsonl'))
  return file ? path.join(dir, file) : null
}

export function resolveSubSessionPath(artifactsDir: string, taskId: string): string | null {
  if (!PI_TASK_SHORT_ID.test(taskId)) return null
  const historyPath = resolveHistorySessionRef(artifactsDir, taskId)
  if (historyPath !== null) return historyPath

  return (
    findSessionFile(getSubSessionDir(artifactsDir, taskId)) ??
    findSessionFile(path.join(artifactsDir, 'sessions', taskId))
  )
}

function resolveHistorySessionRef(artifactsDir: string, taskId: string): string | null {
  const file = path.join(path.dirname(artifactsDir), 'task-session-history.json')
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
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
  const candidate = path.isAbsolute(sessionRef) ? sessionRef : path.join(artifactsDir, sessionRef)
  try {
    const stat = fs.statSync(candidate)
    return stat.isFile() ? candidate : null
  } catch {
    return null
  }
}

export function resolveMostRecentSubSessionPath(artifactsDir: string): string | null {
  const roots = [path.join(artifactsDir, 'tasks', 'sessions'), path.join(artifactsDir, 'sessions')]
  let best: { file: string; mtimeMs: number } | null = null
  for (const root of roots) {
    let taskDirs: string[]
    try {
      taskDirs = fs.readdirSync(root)
    } catch {
      continue
    }
    for (const taskId of taskDirs) {
      if (!PI_TASK_SHORT_ID.test(taskId)) continue
      const dir = path.join(root, taskId)
      let files: string[]
      try {
        files = fs.readdirSync(dir)
      } catch {
        continue
      }
      for (const name of files) {
        if (!name.endsWith('.jsonl')) continue
        const file = path.join(dir, name)
        try {
          const stat = fs.statSync(file)
          if (best === null || stat.mtimeMs > best.mtimeMs) {
            best = { file, mtimeMs: stat.mtimeMs }
          }
        } catch {}
      }
    }
  }
  return best?.file ?? null
}

export function readTaskSessionHistory(cwd: string): TaskHistoryEntry[] {
  const file = path.join(cwd, '.pi', 'task-session-history.json')
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
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
