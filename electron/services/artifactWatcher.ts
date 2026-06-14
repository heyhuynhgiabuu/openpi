/**
 * artifactWatcher — watches `.pi/artifacts/` for per-task CONTEXT.md / RESULT.md.
 *
 * The global sub-agent delegator at `~/.pi/agent/extensions/task/` writes
 * its state as files under `.pi/artifacts/task-<id>/`. When a task starts,
 * the extension creates the directory and writes `CONTEXT.md`. When the
 * sub-agent finishes, it writes `RESULT.md`. The watcher polls the
 * directory and emits an `ARTIFACT_UPDATE` IPC event whenever the set
 * of artifacts or any individual file changes.
 *
 * This replaces the previous in-memory `TaskTracker` (which tracked
 * the Anthropic-style `TaskCreate` / `TaskUpdate` tools) and sources
 * the TODO list directly from the file system.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { BrowserWindow } from 'electron'
import type { ArtifactUpdate, SubagentArtifact } from '../../src/lib/ipc'
import { IPC } from '../../src/lib/ipc/channels'

export interface ArtifactWatcherDeps {
  getMainWindow: () => BrowserWindow | null
  getWorkspacePath: () => string | null
}

interface ArtifactSnapshot {
  mtimeMs: number
  artifact: SubagentArtifact
}

const POLL_MS = 1000

function safeRead(file: string): { content: string; mtimeMs: number } | null {
  try {
    const stat = fs.statSync(file)
    if (!stat.isFile()) return null
    const content = fs.readFileSync(file, 'utf8')
    return { content, mtimeMs: stat.mtimeMs }
  } catch {
    return null
  }
}

function dirMtime(dir: string): number {
  try {
    return fs.statSync(dir).mtimeMs
  } catch {
    return 0
  }
}

function deriveAgent(agentPath: string): string {
  // `.pi/agents/<name>.md` → `<name>`; fallback to basename without extension.
  const base = path.basename(agentPath, path.extname(agentPath))
  return base || 'agent'
}

function inferStatus(resultText: string | null): SubagentArtifact['status'] {
  if (resultText === null) return 'running'
  const lower = resultText.toLowerCase()
  if (lower.includes('error') || lower.includes('failed') || lower.includes('exception')) {
    return 'failed'
  }
  return 'completed'
}

function readArtifact(taskDir: string): SubagentArtifact | null {
  const id = path.basename(taskDir)
  const contextFile = path.join(taskDir, 'CONTEXT.md')
  const resultFile = path.join(taskDir, 'RESULT.md')
  const context = safeRead(contextFile)
  if (!context) return null
  const result = safeRead(resultFile)
  const contextText = context.content
  // Parse frontmatter if present (e.g. `agent: <name>`).
  let agent = 'agent'
  const fmMatch = contextText.match(/^---\s*\n([\s\S]*?)\n---\s*\n/)
  if (fmMatch) {
    const agentLine = fmMatch[1].match(/^\s*agent:\s*(\S+)/m)
    if (agentLine) agent = agentLine[1]
  }
  // Prompt is the first non-empty, non-frontmatter line.
  const body = fmMatch ? contextText.slice(fmMatch[0].length) : contextText
  const promptLine = body.split('\n').find((l) => l.trim().length > 0) ?? ''
  return {
    id,
    agent: deriveAgent(agent),
    prompt: promptLine.trim().slice(0, 500),
    context: contextText,
    result: result?.content ?? null,
    status: inferStatus(result?.content ?? null),
    createdAt: context.mtimeMs,
    completedAt: result?.mtimeMs ?? null,
    filePath: taskDir,
  }
}

export function startArtifactWatcher(deps: ArtifactWatcherDeps): { stop: () => void } {
  const snapshots = new Map<string, ArtifactSnapshot>()
  let lastRootMtime = 0
  let timer: NodeJS.Timeout | null = null

  function getArtifactsDir(): string | null {
    const cwd = deps.getWorkspacePath()
    if (!cwd) return null
    return path.join(cwd, '.pi', 'artifacts')
  }

  function emit() {
    const win = deps.getMainWindow()
    if (!win || win.isDestroyed()) return
    const payload: ArtifactUpdate = {
      artifacts: [...snapshots.values()]
        .map((s) => s.artifact)
        .sort((a, b) => b.createdAt - a.createdAt),
      timestamp: Date.now(),
    }
    win.webContents.send(IPC.ARTIFACT_UPDATE, payload)
  }

  function tick() {
    const dir = getArtifactsDir()
    if (!dir) {
      if (snapshots.size > 0) {
        snapshots.clear()
        emit()
      }
      return
    }
    if (!fs.existsSync(dir)) {
      if (snapshots.size > 0 || lastRootMtime !== 0) {
        snapshots.clear()
        lastRootMtime = 0
        emit()
      }
      return
    }

    const rootMtime = dirMtime(dir)
    if (rootMtime === lastRootMtime) return
    lastRootMtime = rootMtime

    let entries: string[]
    try {
      entries = fs.readdirSync(dir).filter((e) => e.startsWith('task-'))
    } catch {
      entries = []
    }

    const next = new Map<string, ArtifactSnapshot>()
    let changed = false

    for (const entry of entries) {
      const taskDir = path.join(dir, entry)
      try {
        if (!fs.statSync(taskDir).isDirectory()) continue
      } catch {
        continue
      }
      const artifact = readArtifact(taskDir)
      if (!artifact) continue
      const prev = snapshots.get(entry)
      if (!prev || prev.mtimeMs !== (artifact.completedAt ?? artifact.createdAt)) {
        changed = true
      }
      next.set(entry, { mtimeMs: artifact.completedAt ?? artifact.createdAt, artifact })
    }

    // Detect removals
    for (const key of snapshots.keys()) {
      if (!next.has(key)) changed = true
    }

    snapshots.clear()
    for (const [k, v] of next) snapshots.set(k, v)

    if (changed) emit()
  }

  timer = setInterval(tick, POLL_MS)
  // Run once immediately so the renderer gets the initial state.
  tick()

  return {
    stop() {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    },
  }
}
