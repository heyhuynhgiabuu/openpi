/**
 * Diff and hunk math for agent review snapshots.
 *
 * Review changes are stored as before/after content pairs rather than patches,
 * so hunks are derived here from an LCS line diff. The same module computes the
 * synthetic diff text shown when rendering fails, keeping both views consistent.
 */

const MAX_DIFF_LINES = 700
const MAX_DIFF_LINE_LENGTH = 2_000
const MAX_DIFF_CELLS = 250_000

interface DiffLine {
  kind: ' ' | '+' | '-'
  text: string
}

/** One contiguous run of changed lines. A hunk is never split by context. */
export interface ReviewHunk {
  index: number
  /** 1-based line in the before content; the insertion point when `beforeLines` is empty. */
  beforeStart: number
  /** 1-based line in the after content; the insertion point when `afterLines` is empty. */
  afterStart: number
  beforeLines: string[]
  afterLines: string[]
  added: number
  removed: number
}

function lineDiff(before: string[], after: string[]): DiffLine[] {
  const rows = before.length + 1
  const cols = after.length + 1
  const dp = Array.from({ length: rows }, () => new Uint16Array(cols))
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      dp[i][j] =
        before[i] === after[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const output: DiffLine[] = []
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

export function createUnifiedDiff(
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

/**
 * Groups the LCS diff into hunks: one hunk per contiguous run of changed lines.
 * Context never splits or joins hunks, so each hunk maps to exactly one region
 * the user can keep or revert on its own.
 */
export function computeReviewHunks(beforeContent: string, afterContent: string): ReviewHunk[] {
  const hunks: ReviewHunk[] = []
  let beforeLine = 1
  let afterLine = 1
  let current: ReviewHunk | null = null

  const flush = () => {
    if (!current) return
    hunks.push(current)
    current = null
  }

  for (const line of lineDiff(beforeContent.split('\n'), afterContent.split('\n'))) {
    if (line.kind === ' ') {
      flush()
      beforeLine++
      afterLine++
      continue
    }
    current ??= {
      index: hunks.length,
      beforeStart: beforeLine,
      afterStart: afterLine,
      beforeLines: [],
      afterLines: [],
      added: 0,
      removed: 0,
    }
    if (line.kind === '-') {
      current.beforeLines.push(line.text)
      current.removed++
      beforeLine++
    } else {
      current.afterLines.push(line.text)
      current.added++
      afterLine++
    }
  }
  flush()
  return hunks
}

/** Accepts one hunk: the before content adopts that hunk's after lines. */
export function keepHunkInBefore(beforeContent: string, hunk: ReviewHunk): string {
  const before = beforeContent.split('\n')
  before.splice(hunk.beforeStart - 1, hunk.beforeLines.length, ...hunk.afterLines)
  return before.join('\n')
}

/** Rejects one hunk: the after content takes that hunk's before lines back. */
export function revertHunkInAfter(afterContent: string, hunk: ReviewHunk): string {
  const after = afterContent.split('\n')
  after.splice(hunk.afterStart - 1, hunk.afterLines.length, ...hunk.beforeLines)
  return after.join('\n')
}
