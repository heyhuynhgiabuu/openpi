/**
 * Reactive state trackers for Pi extension ecosystems.
 * All state is derived purely from the AgentSessionEvent stream — no sidecar changes needed.
 *
 *   - TaskTracker     — tracks the global task tool's `TaskCreate` and
 *                       `TaskUpdate` calls. The tool itself is provided
 *                       by `@marckrenn/pi-sub-core` in the user's global
 *                       `~/.pi/agent/settings.json`; OpenPi does not
 *                       register its own copy. State is rendered by
 *                       `<TaskWidget>`.
 *   - AskTracker      — tracks the global `AskUserQuestion` tool (provided
 *                       by `ghoseb/pi-askuserquestion` in the user's
 *                       global config). State is rendered by `<AskCard>`.
 *   - SubagentTracker — tracks OpenPi's own `Agent` tool (registered as
 *                       a `customTool` on the sidecar session in
 *                       `electron/subagent/class.ts`). State is rendered
 *                       by `<SubagentWidget>`. This is NOT a global
 *                       Pi package — it is built into OpenPi.
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
  completedAt?: number
  updatedAt?: number
  background: boolean
  turns?: number
  toolCalls?: number
  activity?: string
  error?: string
  result?: string
}

type SubagentUpdateEvent = {
  type?: string
  tool_call_id?: string
  agent_id?: string
  status?: string
  description?: string
  subagent_type?: string
  background?: boolean
  created_at?: number
  started_at?: number
  completed_at?: number
  turns?: number
  tool_calls?: number
  activity?: string
  error?: string
  result?: string
}

function isAgentRunStatus(status: string): status is AgentRunStatus {
  return (
    status === 'queued' || status === 'running' || status === 'completed' || status === 'failed'
  )
}

export class SubagentTracker {
  private agents: TrackedAgent[] = []

  snapshot(): TrackedAgent[] {
    return [...this.agents]
  }

  onToolStart(toolCallId: string, toolName: string, args: Record<string, unknown>): boolean {
    if (toolName !== 'Agent') return false
    const description = String(args.description ?? 'Agent task')
    const subagentType = String(args.subagent_type ?? 'worker')
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
        this.agents[idx] = { ...agent, status: 'failed', result, updatedAt: Date.now() }
        return true
      }
      const idMatch = result.match(/[Aa]gent\s+[Ii][Dd][:：]\s*([a-zA-Z0-9_-]+)/)?.[1]
      // Background agents: status/result managed by onSubagentUpdate events.
      // The tool result text is just the spawn confirmation, not the agent's actual
      // output. Don't overwrite status to avoid a race where onToolEnd fires after
      // onSubagentUpdate has correctly set 'completed' or 'failed'.
      if (agent.background) {
        this.agents[idx] = {
          ...agent,
          agentId: idMatch ?? agent.agentId,
          updatedAt: Date.now(),
        }
        return true
      }
      // Foreground agent: the tool result IS the agent's output
      this.agents[idx] = {
        ...agent,
        agentId: idMatch ?? agent.agentId,
        status: 'completed',
        result: result.slice(0, 2000),
        updatedAt: Date.now(),
      }
      return true
    }
    if (toolName === 'get_subagent_result') {
      const idMatch = result.match(/[Aa]gent\s+[Ii][Dd][:：]\s*([a-zA-Z0-9_-]+)/)?.[1]
      const statusMatch = result.match(/[Ss]tatus[:：]\s*([a-zA-Z_-]+)/)?.[1]
      const status = statusMatch && isAgentRunStatus(statusMatch) ? statusMatch : undefined
      const idx = this.agents.findIndex((a) => a.agentId === idMatch)
      if (idx !== -1 && !isError) {
        const agent = this.agents[idx]
        this.agents[idx] = {
          ...agent,
          status: status ?? agent.status,
          result: result.slice(0, 2000),
          updatedAt: Date.now(),
        }
        return true
      }
    }
    return false
  }

  onSubagentUpdate(event: SubagentUpdateEvent): boolean {
    if (event.type !== 'openpi_subagent_update' || !event.agent_id) return false
    const status = event.status && isAgentRunStatus(event.status) ? event.status : 'running'
    const idx = this.findUpdateTarget(event)
    const next: TrackedAgent = {
      tempId: event.tool_call_id ?? event.agent_id,
      agentId: event.agent_id,
      description: String(event.description ?? 'Agent task'),
      subagentType: String(event.subagent_type ?? 'worker'),
      status,
      startedAt: event.started_at ?? event.created_at ?? Date.now(),
      completedAt: event.completed_at,
      updatedAt: Date.now(),
      background: Boolean(event.background),
      turns: event.turns,
      toolCalls: event.tool_calls,
      activity: event.activity,
      error: event.error,
      result: event.result,
    }
    if (idx === -1) {
      this.agents.push(next)
      return true
    }
    this.agents[idx] = { ...this.agents[idx], ...next }
    return true
  }

  private findUpdateTarget(event: SubagentUpdateEvent): number {
    if (event.tool_call_id) {
      const byToolCall = this.agents.findIndex((a) => a.tempId === event.tool_call_id)
      if (byToolCall !== -1) return byToolCall
    }
    if (event.agent_id) {
      const byAgentId = this.agents.findIndex((a) => a.agentId === event.agent_id)
      if (byAgentId !== -1) return byAgentId
    }
    return -1
  }

  clearFinished() {
    // Keep background agents (user-initiated — persist until explicit dismiss via
    // get_subagent_result or clear()) and running/queued foreground agents.
    this.agents = this.agents.filter(
      (a) => a.background || a.status === 'running' || a.status === 'queued'
    )
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
