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

export interface PlanItem {
  step: string
  status: PlanItemStatus
  explanation?: string
}

export type PlanItemStatus = 'pending' | 'in_progress' | 'completed'

export const MAX_CMD = 72

export function isPlanItemStatus(value: unknown): value is PlanItemStatus {
  return value === 'pending' || value === 'in_progress' || value === 'completed'
}

export function extractFilePath(card: ToolCard): string | null {
  const p = card.args.path ?? card.args.file_path
  return typeof p === 'string' ? p : null
}

export function extractCommand(card: ToolCard): string {
  if (typeof card.args.command === 'string') return card.args.command
  if (typeof card.args.path === 'string') return card.args.path
  if (card.toolName === 'Agent' && typeof card.args.description === 'string')
    return card.args.description
  if (card.toolName === 'TaskCreate' && typeof card.args.subject === 'string')
    return card.args.subject
  if (
    ['TaskGet', 'TaskUpdate', 'TaskStop'].includes(card.toolName) &&
    typeof card.args.taskId === 'string'
  )
    return `#${card.args.taskId}`
  if (card.toolName === 'TaskExecute' && Array.isArray(card.args.task_ids))
    return `[${card.args.task_ids.join(', ')}]`
  if (card.toolName === 'TaskList') return 'all tasks'
  if (card.toolName === 'TaskOutput' && typeof card.args.task_id === 'string')
    return `#${card.args.task_id}`
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
  if (card.toolName.startsWith('spec_')) {
    const name = typeof card.args.name === 'string' ? card.args.name : ''
    switch (card.toolName) {
      case 'spec_create':
        return name
      case 'spec_next_phase':
        return name ? `${name} → next phase` : 'next phase'
      case 'spec_run_task':
        return `${name} · task ${(card.args.taskId as string) ?? ''}`
      case 'spec_run_all':
        return `${name} · run all tasks`
      case 'spec_status':
        return name ? `status: ${name}` : 'legacy specs'
      case 'spec_analyze':
        return `${name} · analyze`
      case 'spec_sync_tasks':
        return `${name} · sync tasks`
      default:
        return name || card.toolName
    }
  }
  return card.toolName
}

export function extractEditPairs(card: ToolCard): EditPair[] {
  const patches = Array.isArray(card.args.patches) ? card.args.patches : []
  return patches
    .map((p: Record<string, unknown>) => ({
      old: String(p.old ?? ''),
      new: String(String(p.new ?? p.new_str ?? '')),
    }))
    .filter((p: EditPair) => p.old || p.new)
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

export function parsePlanItems(args: Record<string, unknown>): PlanItem[] {
  const raw = args.plan
  if (!Array.isArray(raw)) return []
  return raw
    .map((item): PlanItem | null => {
      if (!item || typeof item !== 'object') return null
      const record = item as Record<string, unknown>
      const step = typeof record.step === 'string' ? record.step.trim() : ''
      const status = record.status
      if (!step || !isPlanItemStatus(status)) return null
      return { step, status }
    })
    .filter((item): item is PlanItem => item !== null)
}

export function planStatusLabel(status: PlanItemStatus): string {
  switch (status) {
    case 'completed':
      return 'done'
    case 'in_progress':
      return 'now'
    default:
      return 'next'
  }
}

export function harnessActionForTool(name: string): string {
  switch (name) {
    case 'harness_init':
      return 'Init session'
    case 'harness_intake':
      return 'Intake'
    case 'story_create':
      return 'Create story'
    case 'decision_record':
      return 'Record decision'
    case 'test_matrix_update':
      return 'Update test matrix'
    case 'harness_lint':
      return 'Lint'
    case 'harness_status':
      return 'Status'
    default:
      return 'Tool'
  }
}

export function parseGoalOutputSummary(_toolName: string, output: string): string | null {
  if (!output) return null
  // Strip ANSI escape sequences
  const stripped = output
    .replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '')
    .trim()
  if (!stripped) return null
  const firstLine = stripped.split('\n')[0]?.trim()
  return firstLine || null
}

export function parseHarnessTaskId(card: ToolCard): string | null {
  const id = card.args.taskId ?? card.args.task_id
  return typeof id === 'string' ? id : null
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
