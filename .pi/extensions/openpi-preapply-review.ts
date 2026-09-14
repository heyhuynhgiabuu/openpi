/**
 * OpenPi pre-apply review — optional gate that asks before Pi writes a file.
 *
 * Pi runs its own tools, so the only sanctioned place to stop a write is the
 * `tool_call` event: it fires before the tool executes, can block with
 * `{ block: true, reason }`, and Pi reports the reason back to the model as the
 * tool result. This extension uses that hook plus `ctx.ui.confirm`, which OpenPi
 * renders in its own dialog (the same bridge as every other extension prompt).
 *
 * Off by default: Pi is YOLO by default and a gate stops every edit until the
 * user answers. Enable it per session with OPENPI_PREAPPLY_REVIEW=1 in the
 * environment OpenPi (and therefore the sidecar) is started with.
 *
 * Scope: Pi's built-in `edit` and `write` tools. `edit` replaces one contiguous
 * block, so its preview is that block; `write` is compared against the file on
 * disk. A preview trims the unchanged prefix and suffix, so it shows the changed
 * region instead of the whole file.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

/** Lines of diff shown in the dialog before it is cut off. */
const MAX_PREVIEW_LINES = 120
/** Files larger than this are summarized instead of diffed. */
const MAX_PREVIEW_BYTES = 500_000

export interface PreApplyPreview {
  /** Workspace-relative path when possible, else the path as given. */
  path: string
  /** One line: what the tool is about to do. */
  summary: string
  /** The changed region, `-` for removed and `+` for added lines. */
  body: string
  /** True when the file does not exist yet. */
  created: boolean
}

export function isPreApplyReviewEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.OPENPI_PREAPPLY_REVIEW === '1'
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function displayPath(cwd: string, path: string): string {
  const absolute = isAbsolute(path) ? path : resolve(cwd, path)
  const prefix = `${resolve(cwd)}/`
  return absolute.startsWith(prefix) ? absolute.slice(prefix.length) : path
}

function readTextFile(path: string): string | null {
  try {
    // statSync throws for a missing file, which the catch turns into null.
    const stat = statSync(path)
    if (!stat.isFile()) return null
    if (stat.size > MAX_PREVIEW_BYTES) return null
    const buffer = readFileSync(path)
    if (buffer.includes(0)) return null
    return buffer.toString('utf-8')
  } catch {
    return null
  }
}

/**
 * Renders the changed region of two texts: the common leading and trailing
 * lines are dropped, and what is left is shown as `-`/`+` lines. Exact enough
 * for a confirmation, and it never needs a line-diff algorithm.
 */
export function diffRegion(before: string, after: string): string {
  const beforeLines = before.split('\n')
  const afterLines = after.split('\n')

  let head = 0
  while (head < beforeLines.length && head < afterLines.length) {
    if (beforeLines[head] !== afterLines[head]) break
    head++
  }
  let tail = 0
  while (
    tail < beforeLines.length - head &&
    tail < afterLines.length - head &&
    beforeLines[beforeLines.length - 1 - tail] === afterLines[afterLines.length - 1 - tail]
  ) {
    tail++
  }

  const removed = beforeLines.slice(head, beforeLines.length - tail)
  const added = afterLines.slice(head, afterLines.length - tail)
  const lines = [...removed.map((line) => `-${line}`), ...added.map((line) => `+${line}`)]
  if (lines.length > MAX_PREVIEW_LINES) {
    lines.length = MAX_PREVIEW_LINES
    lines.push('… preview truncated')
  }
  return lines.join('\n')
}

/** "1 line" / "2 lines". */
function lineLabel(count: number): string {
  return `${count} ${count === 1 ? 'line' : 'lines'}`
}

/** Lines of text, ignoring the empty segment a trailing newline produces. */
function countLines(text: string): number {
  if (text === '') return 0
  const segments = text.split('\n')
  return text.endsWith('\n') ? segments.length - 1 : segments.length
}

/** Preview for Pi's `edit` tool: the replacement block is the change. */
export function previewForEdit(
  input: Record<string, unknown>,
  cwd: string
): PreApplyPreview | null {
  const path = str(input.path) ?? str(input.file_path)
  const oldText = str(input.oldText)
  const newText = str(input.newText)
  if (!path || oldText === null || newText === null) return null

  const removed = countLines(oldText)
  const added = countLines(newText)
  return {
    path: displayPath(cwd, path),
    summary: `edit · -${lineLabel(removed)} / +${lineLabel(added)}`,
    body: diffRegion(oldText, newText),
    created: false,
  }
}

/** Preview for Pi's `write` tool: compared against the file on disk. */
export function previewForWrite(
  input: Record<string, unknown>,
  cwd: string
): PreApplyPreview | null {
  const path = str(input.path) ?? str(input.file_path)
  const content = typeof input.content === 'string' ? input.content : null
  if (!path || content === null) return null

  const absolute = isAbsolute(path) ? path : resolve(cwd, path)
  const current = readTextFile(absolute)
  if (current === null) {
    // The file is missing, or it exists but review cannot read it (binary, too
    // large). Reporting an unreadable file as a creation would be a lie, and the
    // user would be approving a blind overwrite.
    if (existsSync(absolute)) {
      return {
        path: displayPath(cwd, path),
        summary: `overwrite · ${lineLabel(countLines(content))}, current content not previewable`,
        body: '',
        created: false,
      }
    }
    return {
      path: displayPath(cwd, path),
      summary: `create · ${lineLabel(countLines(content))}`,
      body: diffRegion('', content),
      created: true,
    }
  }

  if (current === content) {
    return {
      path: displayPath(cwd, path),
      summary: 'no change',
      body: '',
      created: false,
    }
  }

  return {
    path: displayPath(cwd, path),
    summary: `write · ${lineLabel(countLines(current))} → ${lineLabel(countLines(content))}`,
    body: diffRegion(current, content),
    created: false,
  }
}

export function previewForToolCall(
  toolName: string,
  input: unknown,
  cwd: string
): PreApplyPreview | null {
  const record = asRecord(input)
  if (toolName === 'edit') return previewForEdit(record, cwd)
  if (toolName === 'write') return previewForWrite(record, cwd)
  return null
}

export function confirmMessage(preview: PreApplyPreview): string {
  if (!preview.body) {
    return `Pi wants to ${preview.created ? 'create' : 'rewrite'} this file, but the preview is empty.\n\nDeny blocks the write.`
  }
  return `${preview.body}\n\nDeny blocks the write; Allow applies it.`
}

/** The part of Pi's tool_call event and context this gate reads. */
export interface PreApplyToolCall {
  toolName: string
  input: unknown
}

export interface PreApplyContext {
  cwd: string
  ui: { confirm: (title: string, message: string) => Promise<boolean> }
}

export interface BlockedToolCall {
  block: true
  reason: string
}

/**
 * Returns a block result when the user denies the change, and nothing when the
 * call should proceed. Pi reports the reason back to the model as the tool
 * result, so the model knows the change was refused rather than failed.
 */
export async function handleToolCall(
  event: PreApplyToolCall,
  ctx: PreApplyContext
): Promise<BlockedToolCall | undefined> {
  const preview = previewForToolCall(event.toolName, event.input, ctx.cwd)
  if (!preview) return undefined

  const allowed = await ctx.ui.confirm(
    `Review before applying: ${preview.path}`,
    `${preview.summary}\n\n${confirmMessage(preview)}`
  )
  if (allowed) return undefined

  return {
    block: true,
    reason: `The user denied this change in the OpenPi pre-apply review of ${preview.path}. Do not retry it unchanged.`,
  }
}

export default function (pi: ExtensionAPI) {
  if (!isPreApplyReviewEnabled(process.env)) return
  pi.on('tool_call', (event, ctx) => handleToolCall(event, ctx))
}
