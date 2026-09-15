/**
 * gitCommitMessage.ts — Heuristic commit message generator.
 *
 * Extracted from gitHost.ts. A pure function that analyses staged files
 * and produces a conventional-commits-style message.
 */

import type { GitChangedFile } from '../../src/lib/ipc'

// ─── Main entry ───────────────────────────────────────────────────────────

export function generateCommitMessage(
  stagedFiles: GitChangedFile[],
  agentContext?: string
): string {
  if (stagedFiles.length === 0) return ''

  const added = stagedFiles.filter((f) => f.status === 'A')
  const modified = stagedFiles.filter((f) => f.status === 'M')
  const deleted = stagedFiles.filter((f) => f.status === 'D')
  const renamed = stagedFiles.filter((f) => f.status === 'R')
  // Conflicted files arrive staged with status 'U'; they belong in the message
  // even though they match no conventional-commit bucket.
  const others = stagedFiles.filter(
    (f) => f.status !== 'A' && f.status !== 'M' && f.status !== 'D' && f.status !== 'R'
  )

  // Detect scope from common path prefix of changed files
  const scope = detectScope(stagedFiles.map((f) => f.path))

  // Detect conventional commit type from file patterns
  const type = detectType(stagedFiles)

  const prefix = scope ? `${type}(${scope})` : type

  // Fallback: pure heuristic summary
  const summary = buildSummary({ added, modified, deleted, renamed, others })

  // If agent context is available, use it to produce a more descriptive summary.
  // An agent reply that is only a code block (or only thinking) leaves nothing to
  // summarise, so the heuristic summary stands in rather than an empty subject.
  if (agentContext && agentContext.length > 0) {
    const agentSummary = summarizeContext(agentContext)
    const fileList = stagedFiles.map((f) => basename(f.path)).join(', ')
    // Combine: structured prefix + agent-driven summary + file list
    return `${prefix}: ${agentSummary || summary}\n\nFiles: ${fileList}`
  }

  return `${prefix}: ${summary}`
}

// ─── Scope detection ──────────────────────────────────────────────────────

function detectScope(paths: string[]): string {
  // Map well-known path prefixes to semantic scopes
  const scopeMap: [RegExp, string][] = [
    // Current layout, plus the pre-restructure names kept for compatibility
    // (`electron/gitHost.ts` is pinned by tests/gitHostFileTree.test.ts).
    [/^electron\/git\//, 'git'],
    [/^electron\/gitHost/, 'git'],
    [/^electron\/pi\//, 'sidecar'],
    [/^electron\/piSidecar/, 'sidecar'],
    [/^electron\/main/, 'main'],
    [/^electron\/preload/, 'preload'],
    [/^electron\//, 'main'],
    [/^src\/components\/git/, 'git'],
    [/^src\/components\/customizations/, 'customizations'],
    [/^src\/components\/session/, 'session'],
    [/^src\/components\/terminal/, 'terminal'],
    [/^src\/lib\/ipc/, 'ipc'],
    [/^src\/lib\//, 'lib'],
    [/^src\//, 'renderer'],
    [/^tests?\//, 'tests'],
    [/^\.github\//, 'ci'],
    [/^\.pi\//, 'pi'],
    [/^scripts\//, 'scripts'],
  ]

  // Find the most common scope across all paths
  const scored = new Map<string, number>()
  for (const p of paths) {
    for (const [re, label] of scopeMap) {
      if (re.test(p)) {
        scored.set(label, (scored.get(label) ?? 0) + 1)
        break
      }
    }
  }

  if (scored.size === 0) return ''
  // Pick the scope that matches the most files; if tie, take first
  return [...scored.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
}

// ─── Commit type detection ────────────────────────────────────────────────

/**
 * A test path is a file under a `tests/`-style directory or a `*.test.*` /
 * `*.spec.*` file — not merely a path containing those letters. Substring
 * matching labelled `latestStatus.ts` and `inspector.ts` as `test`.
 */
function isTestPath(p: string): boolean {
  return /(^|\/)(tests?|__tests__)\//.test(p) || /\.(test|spec)\.[^./]+$/.test(p)
}

/**
 * Dot-paths and `scripts/` are tooling, except project Pi resources (`.pi/`),
 * which are typed by status like any other source change.
 */
function isCiPath(p: string): boolean {
  if (p.startsWith('.pi/')) return false
  return /^\.|^scripts\//.test(p)
}

function detectType(files: GitChangedFile[]): string {
  const paths = files.map((f) => f.path.toLowerCase())

  const isTest = paths.every(isTestPath)
  const isDocs = paths.every((p) => /\.md$|^docs\//.test(p))
  const isStyle = paths.every((p) => /\.css$|\.scss$|\.sass$|styles\//.test(p))
  const isCi = paths.every(isCiPath)
  const isBuild = paths.every((p) => /package\.json|tsconfig|vite|electron-builder|\.env/.test(p))

  if (isTest) return 'test'
  if (isDocs) return 'docs'
  if (isStyle) return 'style'
  if (isCi) return 'ci'
  if (isBuild) return 'build'

  const hasAdded = files.some((f) => f.status === 'A')
  const hasDeleted = files.some((f) => f.status === 'D')
  const hasModified = files.some((f) => f.status === 'M')

  if (hasAdded && !hasModified && !hasDeleted) return 'feat'
  if (hasDeleted && !hasAdded && !hasModified) return 'chore'
  if (hasModified && !hasAdded && !hasDeleted) return 'fix'
  return 'refactor'
}

// ─── Summary builder ──────────────────────────────────────────────────────

function buildSummary({
  added,
  modified,
  deleted,
  renamed,
  others,
}: {
  added: GitChangedFile[]
  modified: GitChangedFile[]
  deleted: GitChangedFile[]
  renamed: GitChangedFile[]
  /** Staged files matching no status bucket, e.g. conflicted ('U') files. */
  others: GitChangedFile[]
}): string {
  const all = [...added, ...modified, ...deleted, ...renamed, ...others]
  const names = all.map((f) => basename(f.path))

  if (all.length === 1) {
    const first = all[0]
    if (first) {
      const name = basename(first.path)
      if (first.status === 'A') return `add ${name}`
      if (first.status === 'D') return `remove ${name}`
      if (first.status === 'R') return `rename ${name}`
      return `update ${name}`
    }
  }

  // Only an all-adds or all-deletes change reads better as a name list.
  if (
    added.length > 0 &&
    modified.length === 0 &&
    deleted.length === 0 &&
    renamed.length === 0 &&
    others.length === 0
  )
    return `add ${humanList(names)}`
  if (
    deleted.length > 0 &&
    added.length === 0 &&
    modified.length === 0 &&
    renamed.length === 0 &&
    others.length === 0
  )
    return `remove ${humanList(names)}`

  const parts: string[] = []
  if (added.length) parts.push(`add ${added.length} file${added.length > 1 ? 's' : ''}`)
  const updated = modified.length + others.length
  if (updated) parts.push(`update ${updated} file${updated > 1 ? 's' : ''}`)
  if (deleted.length) parts.push(`remove ${deleted.length} file${deleted.length > 1 ? 's' : ''}`)
  if (renamed.length) parts.push(`rename ${renamed.length} file${renamed.length > 1 ? 's' : ''}`)
  return parts.join(', ')
}

// ─── Agent context summarizer ─────────────────────────────────────────────

function summarizeContext(context: string): string {
  // Strip leading/trailing whitespace
  let text = context.trim()
  // Remove markdown code blocks
  text = text.replace(/```[\s\S]*?```/g, '')
  // Remove thinking blocks
  text = text.replace(/<think>[\s\S]*?<\/think>/g, '')
  // Take first 1-2 sentences. Each match keeps its leading whitespace, so trim
  // before joining — otherwise the subject reads "First.  Second.".
  const sentences = text.match(/[^.!?]+[.!?]+/g)
  const firstSentence = sentences?.[0]?.trim() ?? ''
  const secondSentence = sentences?.[1]?.trim() ?? ''
  const summary = secondSentence ? `${firstSentence} ${secondSentence}` : firstSentence
  if (summary.length > 0) {
    if (summary.length <= 120) return summary
    return `${summary.slice(0, 117).trimEnd()}...`
  }
  // Fallback: first line, capped
  const firstLine = text.split('\n')[0]?.trim() ?? ''
  if (firstLine.length > 120) return `${firstLine.slice(0, 117).trimEnd()}...`
  return firstLine
}

function basename(p: string): string {
  // `filter(Boolean)` keeps a trailing slash from yielding an empty name.
  return p.split('/').filter(Boolean).pop() ?? p
}

function humanList(names: string[]): string {
  if (names.length <= 2) return names.join(' and ')
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`
}
