/**
 * goal extension — session-level objective + plan management.
 *
 * Provides:
 *   - 5 LLM tools: get_goal, create_goal, update_goal, clear_goal, update_plan
 *   - /goal slash command with subcommands (edit, pause, resume, clear, budget)
 *   - Goal accounting (token/time tracking, budget enforcement)
 *   - Context injection (<goal_context>, <budget_limit>, <objective_updated>)
 *   - <proposed_plan> streaming detection + plan approval overlay
 *   - Goal state file sync for OpenPi Electron main
 */

import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import type { ExtensionAPI, ExtensionContext, Theme } from '@earendil-works/pi-coding-agent'
import { type Component, truncateToWidth } from '@earendil-works/pi-tui'
import { Type } from 'typebox'

// ── Constants ────────────────────────────────────────────────────────────────

const GOAL_FILE = path.join(homedir(), '.pi', 'agent', '.openpi-goal.json')
const PLAN_FILE = path.join(homedir(), '.pi', 'agent', '.openpi-plan.json')
const MAX_GOAL_OBJECTIVE_CHARS = 2000

const PROPOSED_PLAN_OPEN = '<proposed_plan>'
const PROPOSED_PLAN_CLOSE = '</proposed_plan>'

// ── Types ────────────────────────────────────────────────────────────────────

type GoalStatus = 'active' | 'paused' | 'budget_limited' | 'complete'

type GoalState = {
  goalId: string
  objective: string
  status: GoalStatus
  tokenBudget: number | null
  tokensUsed: number
  timeUsedSeconds: number
  createdAt: number
  updatedAt: number
}

type PlanStepStatus = 'pending' | 'in_progress' | 'completed'

type PlanStep = {
  step: string
  status: PlanStepStatus
}

type UnknownRecord = Record<string, unknown>

type GoalSetEntry = {
  type: 'custom'
  customType: string
  data?: unknown
}

type MessageLike = {
  role?: unknown
  content?: unknown
  usage?: unknown
  metadata?: { usage?: unknown }
}

type UsageLike = {
  inputTokens?: number
  outputTokens?: number
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

type ContextInjectionResult = {
  messages?: Array<{ role: 'user'; content: string }>
}

type ContextAwareExtensionAPI = ExtensionAPI & {
  on(
    event: 'context',
    handler: (_event: unknown, _ctx: ExtensionContext) => ContextInjectionResult
  ): void
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null
}

function isGoalSetEntry(entry: unknown): entry is GoalSetEntry {
  return isRecord(entry) && entry.type === 'custom' && entry.customType === 'goal_set'
}

function asMessageLike(value: unknown): MessageLike {
  return isRecord(value) ? (value as MessageLike) : {}
}

function usageFrom(value: unknown): UsageLike {
  return isRecord(value) ? (value as UsageLike) : {}
}

function numeric(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

// ── Module-level state ───────────────────────────────────────────────────────

let _goal: GoalState | null = null
let _pi: ExtensionAPI | null = null
let _turnStartMs: number | null = null
let _turnTokensStart: number = 0

let _lastObservedObjective: string | null = null
let _budgetLimitInjected = false

let _plan: PlanStep[] | null = null
let _proposedPlanText = ''
let _inProposedPlan = false
let _planWidget: PlanWidget | null = null
let _planWidgetRender: (() => void) | null = null
let _planWidgetTimer: ReturnType<typeof setInterval> | null = null

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateId(): string {
  return randomUUID()
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function formatElapsed(seconds: number): string {
  const s = Math.max(0, seconds)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rm = m % 60
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h ${rm}m`
  return rm === 0 ? `${h}h` : `${h}h ${rm}m`
}

function statusLabel(status: GoalStatus): string {
  switch (status) {
    case 'active':
      return 'active'
    case 'paused':
      return 'paused'
    case 'budget_limited':
      return 'limited by budget'
    case 'complete':
      return 'complete'
  }
}

function goalUsageLabel(goal: GoalState): string {
  if (goal.tokenBudget != null) {
    return `${formatTokens(goal.tokensUsed)} / ${formatTokens(goal.tokenBudget)}`
  }
  return formatElapsed(goal.timeUsedSeconds)
}

function goalStatusFooterText(goal: GoalState | null): string | undefined {
  if (!goal) return undefined
  switch (goal.status) {
    case 'active':
      return `Pursuing goal (${goalUsageLabel(goal)})`
    case 'paused':
      return 'Goal paused (/goal resume)'
    case 'budget_limited':
      return goal.tokenBudget != null
        ? `Goal unmet (${formatTokens(goal.tokensUsed)} / ${formatTokens(goal.tokenBudget)} tokens)`
        : 'Goal abandoned'
    case 'complete':
      return goal.tokenBudget != null
        ? `Goal achieved (${formatTokens(goal.tokensUsed)} tokens)`
        : `Goal achieved (${formatElapsed(goal.timeUsedSeconds)})`
  }
}

function goalStatusLines(goal: GoalState): string[] {
  const lines = [
    `\x1b[1mGoal\x1b[22m`,
    `Status: \x1b[35m${statusLabel(goal.status)}\x1b[39m`,
    `Objective: ${goal.objective}`,
    `Time used: ${formatElapsed(goal.timeUsedSeconds)}`,
    `Tokens used: ${formatTokens(goal.tokensUsed)}`,
  ]
  if (goal.tokenBudget != null) {
    lines.push(`Token budget: ${formatTokens(goal.tokenBudget)}`)
  }
  lines.push('')
  switch (goal.status) {
    case 'active':
      lines.push(
        'Commands: \x1b[36m/goal edit\x1b[39m, \x1b[36m/goal pause\x1b[39m, \x1b[36m/goal clear\x1b[39m'
      )
      break
    case 'paused':
      lines.push(
        'Commands: \x1b[36m/goal edit\x1b[39m, \x1b[36m/goal resume\x1b[39m, \x1b[36m/goal clear\x1b[39m'
      )
      break
    default:
      lines.push('Commands: \x1b[36m/goal edit\x1b[39m, \x1b[36m/goal clear\x1b[39m')
  }
  return lines
}

// ── Plan Helpers ─────────────────────────────────────────────────────────────

const PLAN_SPINNER_FRAMES = ['✳', '✽', '✶', '✷'] as const

interface TextToolResult {
  content: Array<{ type: string; text?: string }>
  details?: { plan?: PlanStep[] }
}

function hasActivePlanStep(plan: PlanStep[] | null): boolean {
  return Boolean(plan?.some((item) => item.status === 'in_progress'))
}

function isPlanComplete(plan: PlanStep[] | null): boolean {
  return Boolean(plan && plan.length > 0 && plan.every((item) => item.status === 'completed'))
}

function completedPlanSteps(plan: PlanStep[] | null): number {
  return plan?.filter((item) => item.status === 'completed').length ?? 0
}

function planStepStatusLabel(status: PlanStepStatus): string {
  switch (status) {
    case 'completed':
      return 'done'
    case 'in_progress':
      return 'now'
    case 'pending':
      return 'next'
  }
}

class PlanResultWidget implements Component {
  constructor(
    private readonly theme: Theme,
    private readonly text: string,
    private readonly isError: boolean
  ) {}

  render(width: number): string[] {
    if (width <= 0 || !this.text) return []
    return [truncateToWidth(this.theme.fg(this.isError ? 'accent' : 'dim', this.text), width)]
  }

  invalidate(): void {
    // Static render.
  }
}

class PlanWidget implements Component {
  private frame = 0

  constructor(
    private readonly theme: Theme,
    private plan: PlanStep[]
  ) {}

  update(plan: PlanStep[]): void {
    this.plan = plan
    this.invalidate()
  }

  tick(): void {
    this.frame = (this.frame + 1) % PLAN_SPINNER_FRAMES.length
    this.invalidate()
  }

  render(width: number): string[] {
    if (width <= 0 || this.plan.length === 0) return []
    const completed = completedPlanSteps(this.plan)
    const active = this.plan.find((item) => item.status === 'in_progress')
    const title = [
      this.theme.fg('accent', this.theme.bold('▣ Plan')),
      this.theme.fg('dim', `${completed}/${this.plan.length} done`),
      active ? this.theme.fg('accent', `Now: ${active.step}`) : '',
    ]
      .filter(Boolean)
      .join(this.theme.fg('dim', ' · '))

    const lines = [truncateToWidth(title, width)]
    for (const item of this.plan) {
      const marker = this.marker(item.status)
      const step =
        item.status === 'completed'
          ? this.theme.fg('muted', item.step)
          : item.status === 'in_progress'
            ? this.theme.fg('text', item.step)
            : this.theme.fg('dim', item.step)
      const status = this.theme.fg(
        item.status === 'in_progress' ? 'accent' : 'dim',
        planStepStatusLabel(item.status)
      )
      lines.push(
        truncateToWidth(` ${marker} ${step} ${this.theme.fg('dim', '·')} ${status}`, width)
      )
    }
    return lines
  }

  invalidate(): void {
    // Stateless render: theme and frame are applied fresh every render.
  }

  private marker(status: PlanStepStatus): string {
    switch (status) {
      case 'completed':
        return this.theme.fg('success', '✓')
      case 'in_progress':
        return this.theme.fg('accent', PLAN_SPINNER_FRAMES[this.frame])
      case 'pending':
        return this.theme.fg('dim', '◻')
    }
  }
}

function stopPlanWidgetTimer(): void {
  if (!_planWidgetTimer) return
  clearInterval(_planWidgetTimer)
  _planWidgetTimer = null
}

function syncPlanWidgetTimer(): void {
  if (hasActivePlanStep(_plan)) {
    if (_planWidgetTimer) return
    _planWidgetTimer = setInterval(() => {
      _planWidget?.tick()
      _planWidgetRender?.()
    }, 160)
    return
  }
  stopPlanWidgetTimer()
}

function formatPlanText(plan: PlanStep[] | null): string {
  if (!plan || plan.length === 0) return 'Plan cleared.'
  const lines = ['Plan updated:']
  for (const item of plan) {
    const marker = item.status === 'completed' ? '✓' : item.status === 'in_progress' ? '●' : '○'
    lines.push(`${marker} ${item.step}`)
  }
  return lines.join('\n')
}

function compactPlanResultText(result: TextToolResult, isError: boolean): string {
  const text = result.content.find((item) => item.type === 'text' && item.text)?.text ?? ''
  if (isError) return text || 'Plan update failed.'
  if (text === 'Plan cleared.' || isPlanComplete(result.details?.plan ?? null))
    return 'Plan complete.'
  return 'Plan dock updated below the editor.'
}

function showPlanWidget(ctx: ExtensionContext) {
  if (!ctx.hasUI) return
  if (!_plan || _plan.length === 0 || isPlanComplete(_plan)) {
    ctx.ui.setWidget('plan', undefined)
    _planWidget = null
    _planWidgetRender = null
    stopPlanWidgetTimer()
    return
  }

  if (_planWidget) {
    _planWidget.update(_plan)
    syncPlanWidgetTimer()
    _planWidgetRender?.()
    return
  }

  ctx.ui.setWidget(
    'plan',
    (tui, theme) => {
      _planWidget = new PlanWidget(theme, _plan ?? [])
      _planWidgetRender = () => tui.requestRender()
      syncPlanWidgetTimer()
      return _planWidget
    },
    { placement: 'belowEditor' }
  )
}

/**
 * Scan text for <proposed_plan>...</proposed_plan> blocks.
 * Stateless — accepts current accumulator state, returns updated state.
 */
function extractProposedPlan(
  text: string,
  inBlock: boolean,
  accumulator: string
): {
  proposedPlanText: string | null
  inBlock: boolean
  accumulator: string
} {
  let planText: string | null = null
  let currentInBlock = inBlock
  let currentAccum = accumulator
  let i = 0

  while (i < text.length) {
    if (!currentInBlock) {
      const openIdx = text.indexOf(PROPOSED_PLAN_OPEN, i)
      if (openIdx < 0) break
      i = openIdx + PROPOSED_PLAN_OPEN.length
      currentInBlock = true
      currentAccum = ''
    } else {
      const closeIdx = text.indexOf(PROPOSED_PLAN_CLOSE, i)
      if (closeIdx < 0) {
        currentAccum += text.slice(i)
        i = text.length
        break
      }
      currentAccum += text.slice(i, closeIdx)
      i = closeIdx + PROPOSED_PLAN_CLOSE.length
      currentInBlock = false
      planText = currentAccum
    }
  }

  return {
    proposedPlanText: planText,
    inBlock: currentInBlock,
    accumulator: currentInBlock ? currentAccum : '',
  }
}

// ── File Sync ────────────────────────────────────────────────────────────────

function writeGoalFile(goal: GoalState | null) {
  try {
    const dir = path.dirname(GOAL_FILE)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      GOAL_FILE,
      JSON.stringify({
        objective: goal?.objective ?? null,
        status: goal?.status ?? null,
        tokensUsed: goal?.tokensUsed ?? 0,
        tokenBudget: goal?.tokenBudget ?? null,
        timeUsedSeconds: goal?.timeUsedSeconds ?? 0,
        timestamp: Date.now(),
      }),
      'utf-8'
    )
  } catch {
    // non-fatal
  }
}

function writePlanFile(plan: PlanStep[] | null) {
  try {
    const dir = path.dirname(PLAN_FILE)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      PLAN_FILE,
      JSON.stringify({
        plan: plan ?? [],
        timestamp: Date.now(),
      }),
      'utf-8'
    )
  } catch {
    // non-fatal
  }
}

// ── UI ───────────────────────────────────────────────────────────────────────

function setGoalStatus(ctx: ExtensionContext) {
  if (!ctx.hasUI) return
  ctx.ui.setStatus('goal', goalStatusFooterText(_goal))
}

function showGoalWidget(ctx: ExtensionContext) {
  if (!ctx.hasUI) return
  if (!_goal) {
    ctx.ui.setWidget('goal', undefined)
    return
  }
  ctx.ui.setWidget('goal', goalStatusLines(_goal))
}

// ── Persistence ──────────────────────────────────────────────────────────────

function persistGoal() {
  if (!_pi) return
  if (!_goal) {
    _pi.appendEntry('goal_set', {
      objective: null,
      status: null,
      clearedAt: Date.now(),
    })
    return
  }
  _pi.appendEntry('goal_set', {
    goalId: _goal.goalId,
    objective: _goal.objective,
    status: _goal.status,
    tokenBudget: _goal.tokenBudget,
    tokensUsed: _goal.tokensUsed,
    timeUsedSeconds: _goal.timeUsedSeconds,
    createdAt: _goal.createdAt,
    updatedAt: _goal.updatedAt,
  })
}

function restoreGoalFromSession(ctx: ExtensionContext) {
  try {
    const entries = ctx.sessionManager.getEntries()
    let lastGoalData: UnknownRecord | null = null
    for (const entry of entries) {
      if (isGoalSetEntry(entry) && isRecord(entry.data)) {
        lastGoalData = entry.data
      }
    }
    if (!lastGoalData || !stringValue(lastGoalData.objective)) {
      _goal = null
      return
    }
    _goal = {
      goalId: stringValue(lastGoalData.goalId) ?? generateId(),
      objective: stringValue(lastGoalData.objective) ?? '',
      status: (stringValue(lastGoalData.status) as GoalStatus | null) ?? 'active',
      tokenBudget: typeof lastGoalData.tokenBudget === 'number' ? lastGoalData.tokenBudget : null,
      tokensUsed: numeric(lastGoalData.tokensUsed),
      timeUsedSeconds: numeric(lastGoalData.timeUsedSeconds),
      createdAt: numeric(lastGoalData.createdAt),
      updatedAt: numeric(lastGoalData.updatedAt),
    }
    _turnTokensStart = _goal.tokensUsed
    _lastObservedObjective = _goal.objective
  } catch {
    _goal = null
  }
}

function resetGoal() {
  _goal = null
  _turnStartMs = null
  _turnTokensStart = 0
  _lastObservedObjective = null
  _budgetLimitInjected = false
  _plan = null
  _proposedPlanText = ''
  _inProposedPlan = false
}

function clearGoalState(ctx: ExtensionContext) {
  resetGoal()
  persistGoal()
  setGoalStatus(ctx)
  showGoalWidget(ctx)
  showPlanWidget(ctx)
  writeGoalFile(null)
  writePlanFile(null)
}

// ── Accounting ───────────────────────────────────────────────────────────────

function accountTurn(ctx: ExtensionContext, timeDeltaSec: number, tokenDelta: number) {
  if (!_goal || _goal.status !== 'active') return
  _goal.timeUsedSeconds += Math.max(0, timeDeltaSec)
  _goal.tokensUsed += Math.max(0, tokenDelta)
  _goal.updatedAt = Date.now()
  if (_goal.tokenBudget != null && _goal.tokensUsed >= _goal.tokenBudget) {
    _goal.status = 'budget_limited'
  }
  persistGoal()
  setGoalStatus(ctx)
  showGoalWidget(ctx)
  writeGoalFile(_goal)
}

// ── Export ───────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  _pi = pi

  // ── Goal LLM tools ──────────────────────────────────────────────────────

  pi.registerTool({
    name: 'get_goal',
    label: 'Get Goal',
    description:
      'Get the current goal for this session, including status, budgets, token and elapsed-time usage, and remaining token budget.',
    promptSnippet: 'Read the current goal status',
    parameters: Type.Object({}),
    execute: async () => {
      const goal = _goal
        ? {
            objective: _goal.objective,
            status: _goal.status,
            tokensUsed: _goal.tokensUsed,
            tokenBudget: _goal.tokenBudget,
            timeUsedSeconds: _goal.timeUsedSeconds,
          }
        : null
      const remaining =
        goal && goal.tokenBudget != null ? Math.max(0, goal.tokenBudget - goal.tokensUsed) : null
      const text = goal
        ? [
            `Status: ${goal.status}`,
            `Objective: ${goal.objective}`,
            `Tokens used: ${goal.tokensUsed}`,
            goal.tokenBudget != null ? `Token budget: ${goal.tokenBudget}` : null,
            remaining != null ? `Remaining tokens: ${remaining}` : null,
            `Time used: ${goal.timeUsedSeconds}s`,
          ]
            .filter(Boolean)
            .join('\n')
        : 'No goal is currently set for this session.'
      return {
        content: [{ type: 'text' as const, text }],
        details: { goal, remainingTokens: remaining },
      }
    },
  })

  pi.registerTool({
    name: 'create_goal',
    label: 'Create Goal',
    description:
      'Create a goal only when explicitly requested by the user or system instructions. Do not infer goals from ordinary tasks. Fails if a goal already exists.',
    promptSnippet: 'Create a new active goal with optional token budget',
    parameters: Type.Object({
      objective: Type.String({ description: 'The concrete objective to start pursuing' }),
      token_budget: Type.Optional(
        Type.Integer({ description: 'Optional positive token budget for the new active goal' })
      ),
    }),
    execute: async (
      _callId: string,
      params: UnknownRecord,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: ExtensionContext
    ) => {
      if (_goal) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `A goal already exists: "${_goal.objective}". Use /goal clear first or update_goal only for completion.`,
            },
          ],
          details: { goal: null as GoalState | null },
          isError: true,
        }
      }
      const objective = (params.objective as string).trim()
      if (!objective || objective.length > MAX_GOAL_OBJECTIVE_CHARS) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Objective must be 1-${MAX_GOAL_OBJECTIVE_CHARS} characters.`,
            },
          ],
          details: { goal: null as GoalState | null },
          isError: true,
        }
      }
      const now = Date.now()
      _goal = {
        goalId: generateId(),
        objective,
        status: 'active',
        tokenBudget: (params.token_budget as number | null | undefined) ?? null,
        tokensUsed: 0,
        timeUsedSeconds: 0,
        createdAt: now,
        updatedAt: now,
      }
      _turnTokensStart = 0
      _lastObservedObjective = objective
      _budgetLimitInjected = false
      persistGoal()
      setGoalStatus(ctx)
      showGoalWidget(ctx)
      writeGoalFile(_goal)
      return {
        content: [{ type: 'text' as const, text: `Goal created: ${objective}` }],
        details: { goal: { ..._goal } as GoalState | null },
      }
    },
  })

  pi.registerTool({
    name: 'update_goal',
    label: 'Update Goal',
    description:
      'Mark the existing goal as complete when the objective has actually been achieved and no required work remains. You cannot pause, resume, or budget-limit a goal through this tool; those are user-only commands.',
    promptSnippet: 'Mark the current goal complete',
    parameters: Type.Object({
      status: Type.String({
        enum: ['complete'],
        description: 'Set to complete only when the objective is achieved',
      }),
    }),
    execute: async (
      _callId: string,
      _params: UnknownRecord,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: ExtensionContext
    ) => {
      if (!_goal) {
        return {
          content: [{ type: 'text' as const, text: 'No goal to update. Use create_goal first.' }],
          details: { goal: null as GoalState | null },
          isError: true,
        }
      }
      if (_goal.status === 'complete') {
        return {
          content: [{ type: 'text' as const, text: 'Goal is already marked complete.' }],
          details: { goal: null as GoalState | null },
        }
      }
      _goal.status = 'complete'
      _goal.updatedAt = Date.now()
      persistGoal()
      setGoalStatus(ctx)
      showGoalWidget(ctx)
      writeGoalFile(_goal)
      const usage =
        _goal.tokenBudget != null
          ? ` (${formatTokens(_goal.tokensUsed)} / ${formatTokens(_goal.tokenBudget)} tokens used)`
          : ` (${formatTokens(_goal.tokensUsed)} tokens, ${formatElapsed(_goal.timeUsedSeconds)})`
      return {
        content: [{ type: 'text' as const, text: `Goal complete: ${_goal.objective}${usage}` }],
        details: { goal: { ..._goal } as GoalState | null },
      }
    },
  })

  pi.registerTool({
    name: 'clear_goal',
    label: 'Clear Goal',
    description:
      'Clear the current goal and ephemeral plan when explicitly requested by the user. This resets OpenPi goal and plan state.',
    promptSnippet: 'Clear the current goal and plan',
    parameters: Type.Object({}),
    execute: async (
      _callId: string,
      _params: UnknownRecord,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: ExtensionContext
    ) => {
      if (!_goal && (!_plan || _plan.length === 0)) {
        clearGoalState(ctx)
        return {
          content: [{ type: 'text' as const, text: 'No goal or plan is currently set.' }],
          details: { goal: null, plan: [] },
        }
      }
      clearGoalState(ctx)
      return {
        content: [{ type: 'text' as const, text: 'Goal and plan cleared.' }],
        details: { goal: null, plan: [] },
      }
    },
  })

  pi.registerTool({
    name: 'update_plan',
    label: 'Update Plan',
    description:
      'Updates the current ephemeral execution plan. Use this for short-lived planning only; use TaskCreate/TaskUpdate from the global task tool (provided by `@marckrenn/pi-sub-core`) for durable tracked tasks, dependencies, ownership, or subagent execution. Provide an optional explanation and the full list of plan items. At most one step can be in_progress at a time.',
    promptSnippet: 'Update the current ephemeral execution plan with steps and statuses',
    parameters: Type.Object({
      explanation: Type.Optional(
        Type.String({ description: 'Optional explanation of plan progress' })
      ),
      plan: Type.Array(
        Type.Object({
          step: Type.String({ description: 'Description of this step' }),
          status: Type.String({
            enum: ['pending', 'in_progress', 'completed'],
            description: 'One of: pending, in_progress, completed',
          }),
        }),
        { description: 'The list of steps' }
      ),
    }),
    renderResult: (result, _options, theme, context) =>
      new PlanResultWidget(theme, compactPlanResultText(result, context.isError), context.isError),
    execute: async (
      _callId: string,
      params: UnknownRecord,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: ExtensionContext
    ) => {
      const steps = params.plan as Array<{ step: string; status: string }>
      const inProgress = steps.filter((s) => s.status === 'in_progress').length
      if (inProgress > 1) {
        return {
          content: [{ type: 'text' as const, text: 'Only one step can be in_progress at a time.' }],
          details: { plan: [] as PlanStep[] },
          isError: true,
        }
      }
      _plan = steps.map((s) => ({
        step: s.step,
        status: s.status as PlanStepStatus,
      }))
      showPlanWidget(ctx)
      writePlanFile(_plan)
      return {
        content: [{ type: 'text' as const, text: formatPlanText(_plan) }],
        details: { plan: _plan as PlanStep[] },
      }
    },
  })

  // ── Context injection ──────────────────────────────────────────────────
  // Injects <goal_context>, <budget_limit>, <objective_updated> fragments
  // before every provider request, matching Codex's approach.
  ;(pi as ContextAwareExtensionAPI).on('context', (_event: unknown, _ctx: ExtensionContext) => {
    if (!_goal) return {}

    const fragments: string[] = []

    // Continuation prompt (every turn while active/paused)
    if (_goal.status === 'active' || _goal.status === 'paused') {
      const remaining =
        _goal.tokenBudget != null ? Math.max(0, _goal.tokenBudget - _goal.tokensUsed) : null
      const lines = [
        '<goal_context>',
        `You are pursuing: ${_goal.objective}`,
        `Status: ${_goal.status}`,
        `Tokens used: ${_goal.tokensUsed}` +
          (_goal.tokenBudget != null ? ` / ${_goal.tokenBudget}` : ''),
        remaining != null ? `Tokens remaining: ${remaining}` : null,
        `Time elapsed: ${formatElapsed(_goal.timeUsedSeconds)}`,
      ]
      if (_goal.status === 'paused') {
        lines.push('The goal is paused. Do not start new work until the user resumes it.')
      }
      lines.push('</goal_context>')
      fragments.push(lines.filter(Boolean).join('\n'))
    }

    // Budget limit prompt (once)
    if (_goal.status === 'budget_limited' && !_budgetLimitInjected) {
      _budgetLimitInjected = true
      fragments.push(
        [
          '<budget_limit>',
          'The active goal has reached its token budget.',
          `Objective: ${_goal.objective}`,
          `Tokens used: ${_goal.tokensUsed}` +
            (_goal.tokenBudget != null ? ` / ${_goal.tokenBudget}` : ''),
          `Time spent: ${formatElapsed(_goal.timeUsedSeconds)}`,
          '',
          'The system has marked the goal as budget_limited. Do not start new substantive work.',
          'Wrap up the current turn: summarize progress, identify remaining work,',
          'and leave the user with a clear next step.',
          'Do not call update_goal unless the goal is actually complete.',
          '</budget_limit>',
        ].join('\n')
      )
    }

    // Objective updated prompt (when user edits via /goal edit)
    if (_goal.objective !== _lastObservedObjective && _lastObservedObjective != null) {
      const remaining =
        _goal.tokenBudget != null ? Math.max(0, _goal.tokenBudget - _goal.tokensUsed) : null
      fragments.push(
        [
          '<objective_updated>',
          'The active thread goal objective was edited by the user.',
          `The new objective: ${_goal.objective}`,
          `Previous objective: ${_lastObservedObjective}`,
          remaining != null ? `Tokens remaining: ${remaining}` : null,
          '',
          'Pursue the updated objective. Avoid continuing work that only served',
          'the previous objective unless it also helps the updated one.',
          '</objective_updated>',
        ]
          .filter(Boolean)
          .join('\n')
      )
    }
    _lastObservedObjective = _goal.objective

    if (fragments.length === 0) return {}
    return {
      messages: [{ role: 'user', content: fragments.join('\n\n') }],
    }
  })

  // ── Lifecycle events ───────────────────────────────────────────────────

  pi.on('session_start', (event, ctx) => {
    if (event.reason === 'new' || event.reason === 'startup') {
      resetGoal()
      if (event.reason === 'startup') restoreGoalFromSession(ctx)
    } else if (event.reason === 'resume' || event.reason === 'fork') {
      restoreGoalFromSession(ctx)
    }
    setGoalStatus(ctx)
    showGoalWidget(ctx)
    showPlanWidget(ctx)
    writeGoalFile(_goal)
    writePlanFile(_plan)
  })

  pi.on('turn_start', () => {
    _turnStartMs = Date.now()
  })

  pi.on('turn_end', (event, ctx) => {
    const now = Date.now()
    const timeDelta = _turnStartMs ? Math.floor((now - _turnStartMs) / 1000) : 0
    _turnStartMs = null

    // Scan for <proposed_plan> blocks (stateless parser)
    const turnMessage = asMessageLike(event.message)
    if (turnMessage.role === 'assistant') {
      const content = stringValue(turnMessage.content) ?? ''
      const result = extractProposedPlan(content, _inProposedPlan, _proposedPlanText)
      _inProposedPlan = result.inBlock
      _proposedPlanText = result.proposedPlanText ?? result.accumulator
    }

    const usage = usageFrom(turnMessage.usage ?? turnMessage.metadata?.usage)
    const tokenDelta =
      numeric(usage.outputTokens ?? usage.completionTokens ?? usage.totalTokens) +
      numeric(usage.inputTokens ?? usage.promptTokens)
    accountTurn(ctx, timeDelta, tokenDelta)
  })

  pi.on('agent_end', async (event, ctx) => {
    if (!_goal || _goal.status !== 'active') return
    const msgs = event.messages ?? []
    let totalTokens = 0
    let proposedPlanFound = ''
    let inBlock = _inProposedPlan
    let accum = _proposedPlanText
    for (const msg of msgs) {
      const message = asMessageLike(msg)
      const u = usageFrom(message.usage ?? message.metadata?.usage)
      totalTokens += numeric(u.totalTokens ?? u.outputTokens ?? u.completionTokens)
      totalTokens += numeric(u.inputTokens ?? u.promptTokens)
      if (!proposedPlanFound && message.role === 'assistant') {
        const content = stringValue(message.content) ?? ''
        const result = extractProposedPlan(content, inBlock, accum)
        inBlock = result.inBlock
        accum = result.accumulator
        if (result.proposedPlanText) proposedPlanFound = result.proposedPlanText
      }
    }
    if (!proposedPlanFound && accum) proposedPlanFound = accum
    _inProposedPlan = false
    _proposedPlanText = ''

    const tokenDelta = Math.max(0, totalTokens - _turnTokensStart)
    _turnTokensStart = totalTokens
    const timeDelta = _turnStartMs ? Math.floor((Date.now() - _turnStartMs) / 1000) : 0
    _turnStartMs = null
    accountTurn(ctx, timeDelta, tokenDelta)

    // Plan approval overlay — only available when UI is present
    if (proposedPlanFound && ctx.hasUI) {
      try {
        const planMd = proposedPlanFound.trim()
        const result = await ctx.ui.custom<string | null>(
          (_tui: unknown, _theme: unknown, _kb: unknown, done: (v: string | null) => void) => ({
            render: (w: number) => {
              const lines = ['\x1b[1mImplement this plan?\x1b[22m', '']
              for (const line of planMd.split('\n').filter(Boolean)) {
                lines.push(`  ${line.length > w - 4 ? `${line.slice(0, w - 7)}…` : line}`)
              }
              lines.push('', '\x1b[36m[1]\x1b[39m Yes, implement this plan')
              lines.push('\x1b[36m[2]\x1b[39m No, stay in current mode')
              lines.push('\x1b[36m[3]\x1b[39m Cancel')
              return lines
            },
            handleInput: (data: string) => {
              if (data === '1') done('implement')
              else if (data === '2' || data === '3' || data === '\x1b') done(null)
            },
            invalidate: () => {},
          }),
          { overlay: true }
        )
        if (result === 'implement') {
          await _pi?.sendUserMessage('Implement the plan.')
        }
      } catch {
        // UI not available in this context
      }
    }
  })

  // ── /goal slash command ────────────────────────────────────────────────

  pi.registerCommand('goal', {
    description:
      'Set or view the current session goal. Usage: /goal <objective>, /goal, /goal edit, /goal pause, /goal resume, /goal clear, /goal budget <num>',
    handler: async (argsString, ctx) => {
      const args = (argsString ?? '').trim()

      if (!args) {
        if (!_goal) {
          if (ctx.hasUI) ctx.ui.notify('No goal set. Usage: /goal <objective>', 'info')
          return
        }
        showGoalWidget(ctx)
        return
      }

      if (args === 'edit') {
        if (!_goal) {
          if (ctx.hasUI) ctx.ui.notify('No goal to edit. Use /goal <objective> first.', 'info')
          return
        }
        if (!ctx.hasUI) return
        const result = await ctx.ui.input('Edit goal', _goal.objective)
        if (result == null) return
        const objective = result.trim()
        if (!objective || objective.length > MAX_GOAL_OBJECTIVE_CHARS) {
          ctx.ui.notify(`Objective must be 1-${MAX_GOAL_OBJECTIVE_CHARS} characters`, 'warning')
          return
        }
        _goal.objective = objective
        _goal.updatedAt = Date.now()
        persistGoal()
        setGoalStatus(ctx)
        showGoalWidget(ctx)
        writeGoalFile(_goal)
        return
      }

      if (args === 'pause') {
        if (!_goal) {
          if (ctx.hasUI) ctx.ui.notify('No active goal to pause.', 'info')
          return
        }
        if (_goal.status !== 'active') {
          if (ctx.hasUI) ctx.ui.notify(`Goal is ${statusLabel(_goal.status)}.`, 'warning')
          return
        }
        _goal.status = 'paused'
        _goal.updatedAt = Date.now()
        persistGoal()
        setGoalStatus(ctx)
        showGoalWidget(ctx)
        writeGoalFile(_goal)
        if (ctx.hasUI) ctx.ui.notify('Goal paused. Use /goal resume to continue.', 'info')
        return
      }

      if (args === 'resume') {
        if (!_goal) {
          if (ctx.hasUI) ctx.ui.notify('No goal to resume.', 'info')
          return
        }
        if (_goal.status !== 'paused') {
          if (ctx.hasUI) ctx.ui.notify(`Goal is ${statusLabel(_goal.status)}.`, 'warning')
          return
        }
        _goal.status = 'active'
        _goal.updatedAt = Date.now()
        _turnTokensStart = _goal.tokensUsed
        persistGoal()
        setGoalStatus(ctx)
        showGoalWidget(ctx)
        writeGoalFile(_goal)
        if (ctx.hasUI) ctx.ui.notify('Goal resumed.', 'info')
        return
      }

      if (args === 'clear') {
        if (!_goal && (!_plan || _plan.length === 0)) {
          if (ctx.hasUI) ctx.ui.notify('No goal or plan to clear.', 'info')
          return
        }
        clearGoalState(ctx)
        if (ctx.hasUI) ctx.ui.notify('Goal and plan cleared.', 'info')
        return
      }

      const budgetMatch = args.match(/^budget\s+(\d+)$/i)
      if (budgetMatch) {
        const budget = parseInt(budgetMatch[1], 10)
        if (!_goal) {
          if (ctx.hasUI) ctx.ui.notify('Set a goal first with /goal <objective>.', 'info')
          return
        }
        _goal.tokenBudget = budget
        _goal.updatedAt = Date.now()
        if (_goal.status === 'active' && _goal.tokensUsed >= budget) _goal.status = 'budget_limited'
        persistGoal()
        setGoalStatus(ctx)
        showGoalWidget(ctx)
        writeGoalFile(_goal)
        if (ctx.hasUI) ctx.ui.notify(`Token budget set to ${formatTokens(budget)}.`, 'info')
        return
      }

      if (args.length > MAX_GOAL_OBJECTIVE_CHARS) {
        if (ctx.hasUI)
          ctx.ui.notify(
            `Goal too long: ${args.length} chars. Limit: ${MAX_GOAL_OBJECTIVE_CHARS}.`,
            'error'
          )
        return
      }

      const now = Date.now()
      _goal = {
        goalId: generateId(),
        objective: args,
        status: 'active',
        tokenBudget: null,
        tokensUsed: 0,
        timeUsedSeconds: 0,
        createdAt: now,
        updatedAt: now,
      }
      _turnTokensStart = 0
      persistGoal()
      setGoalStatus(ctx)
      showGoalWidget(ctx)
      writeGoalFile(_goal)
      // Send the objective as a user message so the agent starts working immediately
      if (ctx.isIdle()) {
        await _pi?.sendUserMessage(args)
      }
      if (ctx.hasUI) ctx.ui.notify(`Goal set: "${args}". Agent is now pursuing this goal.`, 'info')
    },
  })
}
