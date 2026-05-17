/**
 * Reactive state trackers for Pi extension ecosystems.
 * All state is derived purely from the AgentSessionEvent stream — no sidecar changes needed.
 *
 * Covers:
 *   - @tintinweb/pi-tasks     → TaskTracker
 *   - ghoseb/pi-askuserquestion → AskTracker
 *   - @tintinweb/pi-subagents  → SubagentTracker
 */

// ─── Task Tracker ──────────────────────────────────────────────────────────

export type TaskStatus = 'pending' | 'in_progress' | 'completed'

export interface TrackedTask {
  id: string
  subject: string
  status: TaskStatus
  activeForm?: string
  blockedBy: string[]
  owner?: string
}

const TASK_TOOL_NAMES = new Set([
  'TaskCreate',
  'TaskUpdate',
  'TaskList',
  'TaskGet',
  'TaskExecute',
  'TaskOutput',
  'TaskStop',
])

export function isTaskToolName(name: string): boolean {
  return TASK_TOOL_NAMES.has(name)
}

/** Mutable task state — caller wraps in SolidJS createStore or signals */
export class TaskTracker {
  private tasks: TrackedTask[] = []
  // Map toolCallId → task id (while awaiting tool_execution_end for TaskCreate)
  private pendingCreates = new Map<string, string>()

  snapshot(): TrackedTask[] {
    return [...this.tasks]
  }

  onToolStart(toolCallId: string, toolName: string, args: Record<string, unknown>): boolean {
    switch (toolName) {
      case 'TaskCreate': {
        const subject = String(args.subject ?? '(task)')
        const activeForm = args.activeForm ? String(args.activeForm) : undefined
        const tempId = `pending-${toolCallId}`
        this.tasks.push({ id: tempId, subject, status: 'pending', activeForm, blockedBy: [] })
        this.pendingCreates.set(toolCallId, tempId)
        return true
      }
      case 'TaskUpdate': {
        const taskId = String(args.taskId ?? '')
        const idx = this.tasks.findIndex((t) => t.id === taskId)
        if (idx === -1) return false
        const t = this.tasks[idx]
        const next: TrackedTask = { ...t }
        if (args.status === 'deleted') {
          this.tasks.splice(idx, 1)
          return true
        }
        if (args.status && typeof args.status === 'string') next.status = args.status as TaskStatus
        if (args.subject && typeof args.subject === 'string') next.subject = String(args.subject)
        if (args.activeForm !== undefined)
          next.activeForm = args.activeForm ? String(args.activeForm) : undefined
        if (args.owner !== undefined) next.owner = args.owner ? String(args.owner) : undefined
        if (Array.isArray(args.addBlockedBy)) {
          next.blockedBy = [...new Set([...next.blockedBy, ...args.addBlockedBy.map(String)])]
        }
        this.tasks[idx] = next
        return true
      }
      default:
        return false
    }
  }

  onToolEnd(toolCallId: string, toolName: string, result: string): boolean {
    if (toolName !== 'TaskCreate') return false
    const tempId = this.pendingCreates.get(toolCallId)
    if (!tempId) return false
    this.pendingCreates.delete(toolCallId)
    // Parse real ID from "Task #N created successfully: ..." or "→ Task #N created"
    const match = result.match(/[Tt]ask\s*#(\d+)/)?.[1] ?? null
    if (match) {
      const idx = this.tasks.findIndex((t) => t.id === tempId)
      if (idx !== -1) this.tasks[idx] = { ...this.tasks[idx], id: match }
    }
    return true
  }

  clear() {
    this.tasks = []
    this.pendingCreates.clear()
  }
}

// ─── Ask User Question Tracker ─────────────────────────────────────────────

export interface AskOption {
  label: string
  description?: string
}

export interface AskQuestion {
  question: string
  header: string
  options: AskOption[]
  multiSelect: boolean
}

export interface AskState {
  toolCallId: string
  questions: AskQuestion[]
}

function parseAskArgs(args: Record<string, unknown>): AskQuestion[] | null {
  const raw = args.questions
  if (!Array.isArray(raw)) return null
  const questions: AskQuestion[] = []
  for (const q of raw) {
    if (typeof q !== 'object' || q === null) continue
    const r = q as Record<string, unknown>
    const question = String(r.question ?? '')
    const header = String(r.header ?? question.slice(0, 12))
    const multiSelect = Boolean(r.multiSelect)
    const opts = Array.isArray(r.options) ? r.options : []
    const options: AskOption[] = opts.map((o) => {
      const opt = o as Record<string, unknown>
      return {
        label: String(opt.label ?? ''),
        description: opt.description ? String(opt.description) : undefined,
      }
    })
    if (question && options.length >= 2) questions.push({ question, header, options, multiSelect })
  }
  return questions.length > 0 ? questions : null
}

export class AskTracker {
  private state: AskState | null = null

  snapshot(): AskState | null {
    return this.state ? { ...this.state } : null
  }

  onToolStart(toolCallId: string, toolName: string, args: Record<string, unknown>): boolean {
    if (toolName !== 'ask_user_question') return false
    const questions = parseAskArgs(args)
    if (!questions) return false
    this.state = { toolCallId, questions }
    return true
  }

  onToolEnd(_toolCallId: string, toolName: string, _isError = false): boolean {
    if (toolName !== 'ask_user_question') return false
    // Keep the tray prompt visible until the user explicitly submits or dismisses it.
    // Pi may end disabled/stale ask_user_question executions as non-error tool results,
    // but OpenPi still has enough args to render the local widget.
    return true
  }

  clear() {
    this.state = null
  }
}

// ─── Subagent Tracker ──────────────────────────────────────────────────────

export type AgentRunStatus = 'running' | 'completed' | 'failed' | 'queued'

export interface TrackedAgent {
  /** Unique key (toolCallId of the Agent tool call) */
  tempId: string
  /** Real agent ID parsed from tool result (background agents) */
  agentId?: string
  description: string
  subagentType: string
  status: AgentRunStatus
  startedAt: number
  background: boolean
  result?: string
}

export class SubagentTracker {
  private agents: TrackedAgent[] = []

  snapshot(): TrackedAgent[] {
    return [...this.agents]
  }

  onToolStart(toolCallId: string, toolName: string, args: Record<string, unknown>): boolean {
    if (toolName !== 'Agent') return false
    const description = String(args.description ?? 'Agent task')
    const subagentType = String(args.subagent_type ?? 'general-purpose')
    const background = Boolean(args.run_in_background)
    this.agents.push({
      tempId: toolCallId,
      description,
      subagentType,
      status: 'running',
      startedAt: Date.now(),
      background,
    })
    return true
  }

  onToolEnd(toolCallId: string, toolName: string, result: string, isError: boolean): boolean {
    if (toolName === 'Agent') {
      const idx = this.agents.findIndex((a) => a.tempId === toolCallId)
      if (idx === -1) return false
      const agent = this.agents[idx]
      if (isError) {
        this.agents[idx] = { ...agent, status: 'failed', result }
        return true
      }
      // Background: result contains "Agent ID: <id>" or similar
      const idMatch = result.match(/[Aa]gent\s+[Ii][Dd][:：]\s*([a-zA-Z0-9_-]+)/)?.[1]
      this.agents[idx] = {
        ...agent,
        agentId: idMatch ?? undefined,
        status: agent.background ? 'queued' : 'completed',
        result: agent.background ? undefined : result.slice(0, 200),
      }
      return true
    }
    if (toolName === 'get_subagent_result') {
      // Parse agent_id from args (set during onToolStart) — match by result containing agent id
      // Simple heuristic: mark any 'queued' agent as completed
      const queued = this.agents.find((a) => a.background && a.status === 'queued')
      if (queued && !isError) {
        const idx = this.agents.indexOf(queued)
        this.agents[idx] = { ...queued, status: 'completed', result: result.slice(0, 200) }
        return true
      }
    }
    return false
  }

  clearFinished() {
    this.agents = this.agents.filter((a) => a.status === 'running' || a.status === 'queued')
  }

  clear() {
    this.agents = []
  }
}

// ─── Shared helper ─────────────────────────────────────────────────────────

export function formatAskAnswers(
  questions: AskQuestion[],
  answers: Record<string, string[]>
): string {
  const lines = ['User answered your questions:']
  for (const q of questions) {
    const selected = answers[q.question] ?? []
    const answer = selected.length > 0 ? selected.join(', ') : '(no answer)'
    lines.push(`- ${q.question}: ${answer}`)
  }
  return lines.join('\n')
}
