/**
 * diffCount.ts — count added/removed lines in a git patch.
 *
 * Counting by line prefix alone is ambiguous: a removed line whose content is
 * `-- ` arrives in the patch as `--- ` and looks exactly like a file header.
 * These helpers track hunk state instead, so only lines inside a hunk body are
 * counted, and the marker git wrote is the line's first character.
 *
 * Shared by the Git host in Electron main and the renderer's hunk list, so a
 * per-hunk count and the pane's total are computed the same way.
 */

/** Added and removed line counts for one patch. */
export interface DiffLineCount {
  added: number
  removed: number
}

/** Lines of content in a file, ignoring a trailing newline's empty segment. */
export function countContentLines(contents: string): number {
  if (!contents) return 0
  return contents.endsWith('\n')
    ? contents.split(/\r?\n/).length - 1
    : contents.split(/\r?\n/).length
}

/**
 * Count `+`/`-` lines in a unified or combined patch.
 *
 * A unified hunk (`@@`) marks each body line with one character. A combined
 * hunk (`@@@` or more) is what git prints for an unmerged path, and it carries
 * one column per parent: for `git diff` those are stage 2 ("ours") and stage 3
 * ("theirs"). Counting the first column therefore answers "changed against
 * ours", which is what `git diff HEAD --numstat` reports for the same path;
 * counting any other column answers a different question and diverges from it.
 */
export function countDiffLines(raw: string): DiffLineCount {
  let added = 0
  let removed = 0

  let inHunk = false

  for (const line of raw.split('\n')) {
    if (line.startsWith('@@')) {
      inHunk = true
      continue
    }
    if (line.startsWith('diff --')) {
      inHunk = false
      continue
    }
    if (!inHunk) continue
    // `\ No newline at end of file` carries no content.
    if (line.startsWith('\\')) continue

    if (line.startsWith('+')) added++
    else if (line.startsWith('-')) removed++
  }

  return { added, removed }
}
