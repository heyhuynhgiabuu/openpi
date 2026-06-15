import type { ToolCard } from '../../types/session'

export interface AskQuestion {
  question: string
  header?: string
  options?: Array<{ label: string; description?: string }>
  multiSelect?: boolean
}

export interface EditPair {
  old: string
  new: string
}

export const MAX_CMD = 72

export function extractFilePath(card: ToolCard): string | null {
  const p = card.args.path ?? card.args.file_path
  return typeof p === 'string' ? p : null
}

export function extractCommand(card: ToolCard): string {
  if (typeof card.args.command === 'string') return card.args.command
  if (typeof card.args.path === 'string') return card.args.path
  if (card.toolName === 'Agent' && typeof card.args.description === 'string')
    return card.args.description
  if (card.toolName === 'ask_user_question') {
    const qs = card.args.questions
    if (Array.isArray(qs) && qs.length > 0) {
      const first = qs[0] as Record<string, unknown>
      const q = typeof first.question === 'string' ? first.question : ''
      const header = typeof first.header === 'string' ? first.header : ''
      return `✻ ${header || q.slice(0, 60)}`
    }
    return 'question'
  }
  if (card.toolName === 'get_subagent_result' && typeof card.args.agent_id === 'string')
    return `#${card.args.agent_id}`
  if (card.toolName === 'steer_subagent' && typeof card.args.agent_id === 'string')
    return `#${card.args.agent_id}`
  return card.toolName
}

export function extractEditPairs(card: ToolCard): EditPair[] {
  // Pi SDK edit tool: args.edits = Array<{ oldText, newText }>
  const edits = Array.isArray(card.args.edits) ? card.args.edits : []
  if (edits.length > 0) {
    return edits
      .map((e: Record<string, unknown>) => ({
        old: String(e.oldText ?? ''),
        new: String(String(e.newText ?? '')),
      }))
      .filter((p: EditPair) => p.old || p.new)
  }

  // Legacy multiedit format: args.patches = Array<{ old, new }>
  const patches = Array.isArray(card.args.patches) ? card.args.patches : []
  if (patches.length > 0) {
    return patches
      .map((p: Record<string, unknown>) => ({
        old: String(p.old ?? ''),
        new: String(String(p.new ?? p.new_str ?? '')),
      }))
      .filter((p: EditPair) => p.old || p.new)
  }

  // Fallback: args has old/new directly (unstructured)
  const singleOld = String(card.args.old ?? card.args.old_str ?? '')
  const singleNew = String(card.args.new ?? card.args.new_str ?? '')
  return singleOld || singleNew ? [{ old: singleOld, new: singleNew }] : []
}

export function extractWriteLines(card: ToolCard): string[] {
  const content = card.args.content
  if (typeof content === 'string') return content.split('\n')
  return []
}

export function localFileUrl(absPath: string): string {
  return `localfile://${absPath
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/')}`
}

export function isImagePath(p: string): boolean {
  const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'svg', 'avif'])
  return IMAGE_EXTS.has(p.split('.').pop()?.toLowerCase() ?? '')
}

export function parseAskQuestions(args: Record<string, unknown>): AskQuestion[] {
  const raw = args.questions
  if (!Array.isArray(raw)) return []
  return raw
    .map((q): AskQuestion | null => {
      if (!q || typeof q !== 'object') return null
      const record = q as Record<string, unknown>
      const question = typeof record.question === 'string' ? record.question.trim() : ''
      if (!question) return null
      return {
        question,
        header: typeof record.header === 'string' ? record.header : undefined,
        options: Array.isArray(record.options) ? record.options : undefined,
        multiSelect: record.multiSelect === true,
      }
    })
    .filter((q): q is AskQuestion => q !== null)
}
