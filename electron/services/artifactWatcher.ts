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
import type { ArtifactUpdate, SubagentArtifact, TodoListFile } from '../../src/lib/ipc'
import { IPC } from '../../src/lib/ipc/channels'

export interface ArtifactWatcherDeps {
  getMainWindow: () => BrowserWindow | null
  getWorkspacePath: () => string | null
}

interface ArtifactSnapshot {
  mtimeMs: number
  artifact: SubagentArtifact
}

interface TodoSnapshot {
  mtimeMs: number
  todoFile: TodoListFile
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

function parseTodoFile(file: string, artifactsDir: string): TodoSnapshot | null {
  const read = safeRead(file)
  if (!read) return null
  const items = read.content
    .split('\n')
    .map((line) => line.match(/^\s*-\s+\[( |x|X)\]\s+(.+)\s*$/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => ({ text: match[2].trim(), checked: match[1].toLowerCase() === 'x' }))
  if (items.length === 0) return null
  return {
    mtimeMs: read.mtimeMs,
    todoFile: {
      source: path.relative(artifactsDir, file),
      openCount: items.filter((item) => !item.checked).length,
      items,
    },
  }
}

function findTodoFiles(dir: string): string[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const files: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const todo = path.join(dir, entry.name, 'TODO.md')
    if (fs.existsSync(todo)) files.push(todo)
  }
  return files
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
  const todoSnapshots = new Map<string, TodoSnapshot>()
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
      todoFiles: [...todoSnapshots.values()]
        .map((s) => s.todoFile)
        .filter((file) => file.openCount > 0)
        .sort((a, b) => a.source.localeCompare(b.source)),
      timestamp: Date.now(),
    }
    win.webContents.send(IPC.ARTIFACT_UPDATE, payload)
  }

  function tick() {
    const dir = getArtifactsDir()
    if (!dir) {
      if (snapshots.size > 0 || todoSnapshots.size > 0) {
        snapshots.clear()
        todoSnapshots.clear()
        emit()
      }
      return
    }
    if (!fs.existsSync(dir)) {
      if (snapshots.size > 0 || todoSnapshots.size > 0 || lastRootMtime !== 0) {
        snapshots.clear()
        todoSnapshots.clear()
        lastRootMtime = 0
        emit()
      }
      return
    }

    const rootMtime = dirMtime(dir)
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

    const nextTodos = new Map<string, TodoSnapshot>()
    for (const file of findTodoFiles(dir)) {
      const todo = parseTodoFile(file, dir)
      if (!todo) continue
      const key = todo.todoFile.source
      const prev = todoSnapshots.get(key)
      if (
        !prev ||
        prev.mtimeMs !== todo.mtimeMs ||
        prev.todoFile.openCount !== todo.todoFile.openCount
      ) {
        changed = true
      }
      nextTodos.set(key, todo)
    }

    for (const key of todoSnapshots.keys()) {
      if (!nextTodos.has(key)) changed = true
    }

    todoSnapshots.clear()
    for (const [key, value] of nextTodos) todoSnapshots.set(key, value)

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
