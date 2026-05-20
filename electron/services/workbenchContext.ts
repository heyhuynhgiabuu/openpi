/**
 * workbenchContext — lazily-collected context about what the user is looking at.
 *
 * The renderer reports visible file, terminal output, and workspace state
 * via IPC.  This module stores the latest values and provides a formatted
 * context prefix for injection into the Pi agent session.
 *
 * Following the ToolContext pattern from Terax: let the agent know what
 * the user is working on without the user having to describe it.
 */

import type { WebContents } from 'electron'

// ─── State ────────────────────────────────────────────────────────────────────

export interface WorkbenchContext {
  /** Workspace path (cwd of the active session) */
  cwd: string | null

  /** Relative path (from workspace root) of the currently visible file */
  visibleFile: string | null

  /** Absolute path of the currently visible file */
  visibleFileAbs: string | null

  /** Last recorded terminal output snippet (last ~5 lines) */
  terminalOutput: string | null

  /** Timestamp of the last context update */
  updatedAt: string | null
}

let context: WorkbenchContext = {
  cwd: null,
  visibleFile: null,
  visibleFileAbs: null,
  terminalOutput: null,
  updatedAt: null,
}

// ─── IPC sender binding ───────────────────────────────────────────────────────

let sender: WebContents | null = null

export function bindWebContents(webContents: WebContents | null): void {
  sender = webContents
}

// ─── Update functions ─────────────────────────────────────────────────────────

export function updateCwd(cwd: string | null): void {
  context = { ...context, cwd, updatedAt: new Date().toISOString() }
  broadcast()
}

export function updateVisibleFile(relPath: string | null, absPath: string | null): void {
  context = {
    ...context,
    visibleFile: relPath,
    visibleFileAbs: absPath,
    updatedAt: new Date().toISOString(),
  }
  broadcast()
}

export function updateTerminalOutput(output: string | null): void {
  context = { ...context, terminalOutput: output, updatedAt: new Date().toISOString() }
  broadcast()
}

function broadcast(): void {
  if (sender && !sender.isDestroyed()) {
    sender.send('openpi:workbench-context-changed', context)
  }
}

// ─── Reader ───────────────────────────────────────────────────────────────────

export function getWorkbenchContext(): WorkbenchContext {
  return { ...context }
}

// ─── Context prefix builder ───────────────────────────────────────────────────

/**
 * Build a concise context prefix for the Pi agent.
 *
 * Follows the ToolContext pattern: agent receives structured hints about
 * what the user is looking at without the user having to type it.
 *
 * Returns null when no context is available (avoid injecting boilerplate).
 */
export function buildWorkbenchContextPrefix(): string | null {
  const parts: string[] = []

  if (context.cwd) {
    parts.push(`Workspace: ${context.cwd}`)
  }

  if (context.visibleFile) {
    const abs = context.visibleFileAbs ? ` (${context.visibleFileAbs})` : ''
    parts.push(`Viewing file: ${context.visibleFile}${abs}`)
  }

  if (context.terminalOutput) {
    // Only include terminal output if it's recent and non-empty
    const cleaned = context.terminalOutput.trim()
    if (cleaned.length > 0) {
      parts.push(`Terminal output:\n\`\`\`\n${cleaned}\n\`\`\``)
    }
  }

  if (parts.length === 0) return null

  return `<workbench_context>\n${parts.join('\n')}\n</workbench_context>`
}
