import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { readWorkspaceFile, resolveWorkspacePath } from './workspacePath'

function resolveTaskSessionFile(cwd: string, taskId: string): string | null {
  const sessionRoots = [
    path.join(cwd, '.pi', 'artifacts', 'tasks', 'sessions'),
    path.join(cwd, '.pi', 'artifacts', 'sessions'),
  ]
  for (const submittedRoot of sessionRoots) {
    try {
      const root = resolveWorkspacePath(
        cwd,
        path.relative(cwd, submittedRoot),
        'read task session status'
      )
      const dir = resolveWorkspacePath(
        cwd,
        path.relative(cwd, path.join(root, taskId)),
        'read task session status'
      )
      if (!fs.lstatSync(dir).isDirectory()) continue
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      const file = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
        .map((entry) => path.join(dir, entry.name))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0]
      if (file) return file
    } catch {}
  }
  return null
}

function assistantStopReason(line: string): string | null | undefined {
  const trimmed = line.trim()
  if (!trimmed) return undefined
  try {
    const entry = JSON.parse(trimmed) as {
      type?: unknown
      message?: { role?: unknown; stopReason?: unknown }
    }
    if (entry.type !== 'message' || entry.message?.role !== 'assistant') return undefined
    const stopReason = entry.message.stopReason
    return typeof stopReason === 'string' ? stopReason : null
  } catch {
    return undefined
  }
}

function readSubSessionExecutionStatus(cwd: string, taskId: string): 'running' | 'done' | null {
  const sessionFile = resolveTaskSessionFile(cwd, taskId)
  if (!sessionFile) return null

  let raw: string
  try {
    raw = readWorkspaceFile(sessionFile, cwd)
  } catch {
    return null
  }

  let latest: 'running' | 'done' | null = null
  for (const line of raw.split('\n')) {
    const stopReason = assistantStopReason(line)
    if (stopReason === undefined) continue
    latest = stopReason === null || stopReason === 'toolUse' ? 'running' : 'done'
  }

  return latest
}

function tmuxPaneExists(paneId: string): boolean {
  try {
    const out = execFileSync('tmux', ['display-message', '-p', '-t', paneId, '#{pane_id}'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return out === paneId
  } catch {
    return false
  }
}

export function normalizeTaskHistoryStatus(
  cwd: string,
  taskId: string,
  status: string | undefined,
  paneId?: string,
  paneExists: (paneId: string) => boolean = tmuxPaneExists
): string | undefined {
  if (status !== 'cancelled') return status
  const executionStatus = readSubSessionExecutionStatus(cwd, taskId)
  if (executionStatus === 'done') return 'done'
  if (executionStatus === 'running' && paneId && paneExists(paneId)) return 'running'
  return status
}
