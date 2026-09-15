/**
 * hunkUtils — Phase 3: pure utility functions for splitting and analyzing
 * raw unified-diff patches into individual hunk patches.
 *
 * Extracted from GitHunkActions.tsx for testability.
 */

/**
 * Extract the file header lines (everything before the first @@ line)
 * from a raw unified diff. These lines include `diff --git`, `index`,
 * `--- a/...`, `+++ b/...`, and `new file mode` / `deleted file mode`.
 */
export function extractFileHeader(raw: string): string {
  const lines = raw.split('\n')
  const headerLines: string[] = []
  for (const line of lines) {
    if (line.startsWith('@@ ')) break
    headerLines.push(line)
  }
  return headerLines.join('\n')
}

/**
 * Split a raw unified diff into individual hunk patches.
 * Each returned string is a self-contained patch that includes the file
 * header lines (diff --git, ---, +++, index, etc.) followed by a single
 * @@ block, so it can be consumed by `git apply`.
 */
export function splitRawPatch(raw: string): string[] {
  if (!raw) return []

  const normalized = raw.replace(/\r\n/g, '\n')
  const header = extractFileHeader(normalized)

  // No @@ hunks — return the whole thing as a single patch
  if (!normalized.includes('@@ ')) {
    return normalized.trim() ? [normalized] : []
  }

  const lines = normalized.split('\n')
  const hunks: string[] = []
  let currentHunk: string[] = []

  for (const line of lines) {
    if (line.startsWith('@@ ')) {
      // Flush previous hunk
      if (currentHunk.length > 0) {
        hunks.push(`${header}\n${currentHunk.join('\n')}`)
      }
      currentHunk = [line]
    } else if (currentHunk.length > 0) {
      currentHunk.push(line)
    }
    // Lines before the first @@ are part of the header, skip them here
  }

  // Flush last hunk
  if (currentHunk.length > 0) {
    hunks.push(`${header}\n${currentHunk.join('\n')}`)
  }

  return hunks
}

/**
 * Extract the @@ header line from a hunk patch for display.
 */
export function hunkHeading(patch: string): string {
  for (const line of patch.split('\n')) {
    if (line.startsWith('@@ ')) return line.slice(0, 60)
  }
  return 'Hunk'
}
