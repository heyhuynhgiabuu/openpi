/**
 * Preview helpers for the pre-apply review gate.
 *
 * They turn an `edit` or `write` tool call into something a user can judge: a
 * summary line plus the changed region, with the unchanged prefix and suffix
 * trimmed. `edit` carries `edits[]`, each replacing one contiguous block, so
 * every entry becomes a hunk; `write` is compared against the file on disk.
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

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

export function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function displayPath(cwd: string, path: string): string {
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

/** One `edits[]` entry, ready for the review dialog. */
export interface ReviewHunk {
  diff: string
  removed: number
  added: number
}

/**
 * Hunks of an `edit` call, in the order Pi applies them. One call carries
 * `edits[]`, and each entry replaces one contiguous block. Returns null when the
 * call carries no usable entry: the tool itself would fail, so the gate stays
 * out of the way instead of asking about a change that cannot happen.
 */
export function editHunks(input: Record<string, unknown>): ReviewHunk[] | null {
  const edits = Array.isArray(input.edits) ? input.edits : []
  if (edits.length === 0) return null

  const hunks: ReviewHunk[] = []
  for (const entry of edits) {
    const oldText = str(asRecord(entry).oldText)
    const newText = str(asRecord(entry).newText)
    if (oldText === null || newText === null) return null
    hunks.push({
      diff: diffRegion(oldText, newText),
      removed: countLines(oldText),
      added: countLines(newText),
    })
  }
  return hunks
}

/** One line for the dialog header: what the call changes, in total. */
export function hunksSummary(hunks: ReviewHunk[]): string {
  const removed = hunks.reduce((total, hunk) => total + hunk.removed, 0)
  const added = hunks.reduce((total, hunk) => total + hunk.added, 0)
  const count = hunks.length > 1 ? ` · ${hunks.length} hunks` : ''
  return `edit · -${lineLabel(removed)} / +${lineLabel(added)}${count}`
}

/** Preview for Pi's `edit` tool: every edit is a hunk of the change. */
export function previewForEdit(
  input: Record<string, unknown>,
  cwd: string
): PreApplyPreview | null {
  const path = str(input.path)
  const hunks = editHunks(input)
  if (!path || !hunks) return null

  return {
    path: displayPath(cwd, path),
    summary: hunksSummary(hunks),
    body: hunks.map((hunk) => hunk.diff).join('\n\n'),
    created: false,
  }
}

/** Preview for Pi's `write` tool: compared against the file on disk. */
export function previewForWrite(
  input: Record<string, unknown>,
  cwd: string
): PreApplyPreview | null {
  const path = str(input.path)
  const content = str(input.content)
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
