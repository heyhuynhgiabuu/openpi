export interface DiffLineSnippetInput {
  text: string | null | undefined
  startLine: number
  endLine: number
  maxLines?: number
}

export function buildDiffLineSnippet({
  text,
  startLine,
  endLine,
  maxLines = 2,
}: DiffLineSnippetInput): string {
  if (!text) return ''
  const lines = text.split('\n')
  const start = Math.max(1, Math.min(startLine, endLine))
  const end = Math.max(startLine, endLine)
  const slice = lines.slice(start - 1, end)
  if (slice.length === 0) return ''
  return slice.slice(0, maxLines).join('\n')
}
