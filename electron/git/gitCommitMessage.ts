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

  // Detect scope from common path prefix of changed files
  const scope = detectScope(stagedFiles.map((f) => f.path))

  // Detect conventional commit type from file patterns
  const type = detectType(stagedFiles)

  const prefix = scope ? `${type}(${scope})` : type

  // If agent context is available, use it to produce a more descriptive summary
  if (agentContext && agentContext.length > 0) {
    const agentSummary = summarizeContext(agentContext)
    const fileList = stagedFiles.map((f) => basename(f.path)).join(', ')
    // Combine: structured prefix + agent-driven summary + file list
    return `${prefix}: ${agentSummary}\n\nFiles: ${fileList}`
  }

  // Fallback: pure heuristic summary
  const summary = buildSummary({ added, modified, deleted, renamed })
  return `${prefix}: ${summary}`
}

// ─── Scope detection ──────────────────────────────────────────────────────

function detectScope(paths: string[]): string {
  // Map well-known path prefixes to semantic scopes
  const scopeMap: [RegExp, string][] = [
    [/^electron\/gitHost/, 'git'],
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

function detectType(files: GitChangedFile[]): string {
  const paths = files.map((f) => f.path.toLowerCase())

  const isTest = paths.every((p) => /test|spec/.test(p))
  const isDocs = paths.every((p) => /\.md$|^docs\//.test(p))
  const isStyle = paths.every((p) => /\.css$|\.scss$|\.sass$|styles\//.test(p))
  const isCi = paths.every((p) => /^\.github\/|^scripts\/|^\./.test(p))
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
}: {
  added: GitChangedFile[]
  modified: GitChangedFile[]
  deleted: GitChangedFile[]
  renamed: GitChangedFile[]
}): string {
  const all = [...added, ...modified, ...deleted, ...renamed]
  const names = all.map((f) => basename(f.path))

  if (all.length === 1) {
    const f = all[0]!
    const name = basename(f.path)
    if (f.status === 'A') return `add ${name}`
    if (f.status === 'D') return `remove ${name}`
    if (f.status === 'R') return `rename ${name}`
    return `update ${name}`
  }

  if (added.length > 0 && modified.length === 0 && deleted.length === 0)
    return `add ${humanList(names)}`
  if (deleted.length > 0 && added.length === 0 && modified.length === 0)
    return `remove ${humanList(names)}`

  const parts: string[] = []
  if (added.length) parts.push(`add ${added.length} file${added.length > 1 ? 's' : ''}`)
  if (modified.length) parts.push(`update ${modified.length} file${modified.length > 1 ? 's' : ''}`)
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
  // Take first 1-2 sentences
  const sentences = text.match(/[^.!?]+[.!?]+/g)
  if (sentences && sentences.length > 0) {
    const summary = (sentences[0] + (sentences[1] ? ` ${sentences[1]}` : '')).trim()
    if (summary.length <= 120) return summary
    return `${summary.slice(0, 117).trimEnd()}...`
  }
  // Fallback: first line, capped
  const firstLine = text.split('\n')[0]?.trim() ?? ''
  if (firstLine.length > 120) return `${firstLine.slice(0, 117).trimEnd()}...`
  return firstLine
}

function basename(p: string): string {
  return p.split('/').pop() ?? p
}

function humanList(names: string[]): string {
  if (names.length <= 2) return names.join(' and ')
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`
}
