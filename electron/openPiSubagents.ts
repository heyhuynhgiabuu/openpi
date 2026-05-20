import { randomUUID } from 'node:crypto'
import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import type { Api, Model } from '@earendil-works/pi-ai'
import type {
  AgentSessionEvent,
  ExtensionContext,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { type AgentConfig, discoverAgents } from './openPiSubagentAgents'

type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
type SubagentStatus = 'queued' | 'running' | 'completed' | 'failed'
type ToolResult = AgentToolResult<Record<string, unknown>>
type SubagentSession = Awaited<ReturnType<typeof createAgentSession>>['session']

type RuntimeOptions = {
  getAgentDir: () => string
  isWorkspaceTrusted: () => boolean
  maxConcurrent?: number
  onSubagentUpdate?: (update: OpenPiSubagentUpdate) => void
}

type AgentRunParams = {
  prompt: string
  description?: string
  subagent_type?: string
  model?: string
  thinking?: ThinkingLevel
  max_turns?: number
  run_in_background?: boolean
  resume?: string
}

export type OpenPiSubagentUpdate = {
  type: 'openpi_subagent_update'
  tool_call_id?: string
  agent_id: string
  status: SubagentStatus
  description: string
  subagent_type: string
  background: boolean
  created_at: number
  started_at?: number
  completed_at?: number
  turns: number
  tool_calls: number
  result?: string
  error?: string
  activity?: string
}

type SubagentRecord = {
  id: string
  parentToolCallId?: string
  description: string
  subagentType: string
  prompt: string
  status: SubagentStatus
  background: boolean
  createdAt: number
  startedAt?: number
  completedAt?: number
  turns: number
  toolCalls: number
  resultText: string
  error?: string
  activity?: string
  session?: SubagentSession
  unsubscribe?: () => void
  done: Promise<SubagentRecord>
  resolveDone: (record: SubagentRecord) => void
}

type QueueItem = {
  record: SubagentRecord
  agent: AgentConfig
  params: AgentRunParams
  ctx: ExtensionContext
}

const AgentParams = Type.Object({
  prompt: Type.String({ description: 'The task for the subagent to perform.' }),
  description: Type.Optional(Type.String({ description: 'Short description shown in UI.' })),
  subagent_type: Type.Optional(
    Type.String({
      description:
        'Agent type: worker, explorer, scout, planner, reviewer, or a .pi/agents/<name>.md file. When the user mentions @name in their prompt, set this to the name after @.',
    })
  ),
  model: Type.Optional(
    Type.String({
      description: 'Optional model override. Use provider/modelId or a unique fuzzy id/name match.',
    })
  ),
  thinking: Type.Optional(
    Type.Union([
      Type.Literal('off'),
      Type.Literal('minimal'),
      Type.Literal('low'),
      Type.Literal('medium'),
      Type.Literal('high'),
      Type.Literal('xhigh'),
    ])
  ),
  max_turns: Type.Optional(
    Type.Number({ description: 'Maximum turns before the subagent is aborted.' })
  ),
  run_in_background: Type.Optional(
    Type.Boolean({
      description: 'Return immediately with an agent id while the subagent continues.',
    })
  ),
  resume: Type.Optional(
    Type.String({ description: 'Resume a completed subagent by id with a new prompt.' })
  ),
})

const GetResultParams = Type.Object({
  agent_id: Type.String({ description: 'Agent id returned by Agent.' }),
  wait: Type.Optional(Type.Boolean({ description: 'Wait for completion before returning.' })),
  verbose: Type.Optional(Type.Boolean({ description: 'Include detailed run metadata.' })),
})

const SteerParams = Type.Object({
  agent_id: Type.String({ description: 'Running agent id to steer.' }),
  message: Type.String({
    description: 'Message to inject before the subagent next calls the model.',
  }),
})

function createDone(): Pick<SubagentRecord, 'done' | 'resolveDone'> {
  let resolveDone!: (record: SubagentRecord) => void
  const done = new Promise<SubagentRecord>((resolve) => {
    resolveDone = resolve
  })
  return { done, resolveDone }
}

function textResult(text: string, details: Record<string, unknown> = {}): ToolResult {
  return { content: [{ type: 'text', text }], details }
}

function errorResult(text: string, details: Record<string, unknown> = {}): ToolResult {
  return { content: [{ type: 'text', text }], details: { ...details, isError: true } }
}

export function assistantText(message: unknown): string {
  const content = (message as { content?: unknown }).content
  if (!Array.isArray(content)) return ''
  return content
    .filter((part): part is { type: 'text'; text: string } =>
      Boolean(
        part &&
          typeof part === 'object' &&
          (part as { type?: unknown }).type === 'text' &&
          typeof (part as { text?: unknown }).text === 'string'
      )
    )
    .map((part) => part.text)
    .join('')
}

function normalizeAgentName(name: string): string {
  return name.toLowerCase()
}

function resolveAgent(
  type: string | undefined,
  ctx: ExtensionContext,
  options: RuntimeOptions
): AgentConfig {
  const requested = type ?? 'worker'
  const agents = discoverAgents(ctx.cwd, options.getAgentDir(), options.isWorkspaceTrusted())
  const exact = agents.find((agent) => agent.name === requested)
  if (exact) return exact
  const normalized = normalizeAgentName(requested)
  const fuzzy = agents.find((agent) => normalizeAgentName(agent.name) === normalized)
  if (fuzzy) return fuzzy
  const available = agents.map((agent) => agent.name).join(', ')
  throw new Error(`Unknown subagent_type "${requested}". Available agents: ${available}`)
}

function resolveModel(ctx: ExtensionContext, requested?: string): Model<Api> | undefined {
  if (!requested) return ctx.model
  const exactParts = requested.split('/')
  if (exactParts.length === 2) {
    return ctx.modelRegistry.find(exactParts[0], exactParts[1])
  }
  const needle = requested.toLowerCase()
  const candidates = [...ctx.modelRegistry.getAvailable(), ...ctx.modelRegistry.getAll()]
  return candidates.find((model) => {
    const provider = String(model.provider).toLowerCase()
    return (
      model.id.toLowerCase() === needle ||
      model.name.toLowerCase() === needle ||
      `${provider}/${model.id.toLowerCase()}`.includes(needle)
    )
  })
}

function summarizeRecord(record: SubagentRecord): Record<string, unknown> {
  return {
    agent_id: record.id,
    tool_call_id: record.parentToolCallId,
    status: record.status,
    description: record.description,
    subagent_type: record.subagentType,
    background: record.background,
    created_at: record.createdAt,
    started_at: record.startedAt,
    completed_at: record.completedAt,
    turns: record.turns,
    tool_calls: record.toolCalls,
    error: record.error,
    activity: record.activity,
  }
}

function updateFromRecord(record: SubagentRecord): OpenPiSubagentUpdate {
  return {
    type: 'openpi_subagent_update',
    tool_call_id: record.parentToolCallId,
    agent_id: record.id,
    status: record.status,
    description: record.description,
    subagent_type: record.subagentType,
    background: record.background,
    created_at: record.createdAt,
    started_at: record.startedAt,
    completed_at: record.completedAt,
    turns: record.turns,
    tool_calls: record.toolCalls,
    result: record.resultText ? record.resultText.slice(0, 4000) : undefined,
    error: record.error,
    activity: record.activity,
  }
}

class SubagentManager {
  private readonly records = new Map<string, SubagentRecord>()
  private readonly queue: QueueItem[] = []
  private running = 0
  private readonly maxConcurrent: number

  constructor(private readonly options: RuntimeOptions) {
    this.maxConcurrent = options.maxConcurrent ?? 4
  }

  spawn(params: AgentRunParams, ctx: ExtensionContext, parentToolCallId?: string): SubagentRecord {
    if (params.resume) return this.resume(params.resume, params, ctx, parentToolCallId)
    const agent = resolveAgent(params.subagent_type, ctx, this.options)
    const doneParts = createDone()
    const record: SubagentRecord = {
      id: randomUUID().slice(0, 8),
      parentToolCallId,
      description: params.description ?? agent.description,
      subagentType: agent.name,
      prompt: params.prompt,
      status: 'queued',
      background: Boolean(params.run_in_background),
      createdAt: Date.now(),
      turns: 0,
      toolCalls: 0,
      resultText: '',
      activity: 'Queued',
      ...doneParts,
    }
    this.records.set(record.id, record)
    this.emit(record)
    this.enqueue(record, agent, params, ctx)
    return record
  }

  get(id: string): SubagentRecord | undefined {
    return this.records.get(id)
  }

  async wait(id: string): Promise<SubagentRecord> {
    const record = this.records.get(id)
    if (!record) throw new Error(`Unknown subagent id: ${id}`)
    return record.done
  }

  async steer(id: string, message: string): Promise<void> {
    const record = this.records.get(id)
    if (!record) throw new Error(`Unknown subagent id: ${id}`)
    if (record.status !== 'running' || !record.session) {
      throw new Error(`Subagent ${id} is ${record.status}; only running subagents can be steered.`)
    }
    await record.session.steer(message)
  }

  private resume(
    id: string,
    params: AgentRunParams,
    ctx: ExtensionContext,
    parentToolCallId?: string
  ): SubagentRecord {
    const record = this.records.get(id)
    if (!record) throw new Error(`Unknown subagent id: ${id}`)
    if (record.status === 'running' || record.status === 'queued') {
      throw new Error(`Subagent ${id} is ${record.status}; use steer_subagent for active agents.`)
    }
    const agent = resolveAgent(record.subagentType, ctx, this.options)
    const doneParts = createDone()
    record.parentToolCallId = parentToolCallId
    record.prompt = params.prompt
    record.description = params.description ?? record.description
    record.status = 'queued'
    record.background = Boolean(params.run_in_background)
    record.completedAt = undefined
    record.error = undefined
    record.resultText = ''
    record.activity = 'Queued'
    record.turns = 0
    record.toolCalls = 0
    record.done = doneParts.done
    record.resolveDone = doneParts.resolveDone
    this.emit(record)
    this.enqueue(record, agent, params, ctx)
    return record
  }

  private enqueue(
    record: SubagentRecord,
    agent: AgentConfig,
    params: AgentRunParams,
    ctx: ExtensionContext
  ): void {
    this.queue.push({ record, agent, params, ctx })
    this.drain()
  }

  private drain(): void {
    while (this.running < this.maxConcurrent) {
      const next = this.queue.shift()
      if (!next) return
      this.running += 1
      void this.start(next.record, next.agent, next.params, next.ctx).finally(() => {
        this.running -= 1
        this.drain()
      })
    }
  }

  private async start(
    record: SubagentRecord,
    agent: AgentConfig,
    params: AgentRunParams,
    ctx: ExtensionContext
  ): Promise<void> {
    record.status = 'running'
    record.startedAt = Date.now()
    record.activity = 'Starting'
    this.emit(record)
    // Use agent config defaults, overridden by explicit params
    const effectiveMaxTurns = params.max_turns ?? agent.maxTurns
    const effectiveParams = { ...params, max_turns: effectiveMaxTurns }
    try {
      const session = record.session ?? (await this.createSession(agent, effectiveParams, ctx))
      record.session = session
      record.unsubscribe?.()
      record.unsubscribe = session.subscribe((event) => {
        this.captureEvent(record, session, effectiveParams, event)
      })
      await session.prompt(this.buildPrompt(agent, params.prompt))
      if (record.status === 'running') {
        record.status = 'completed'
        record.completedAt = Date.now()
        record.activity = 'Completed'
      }
    } catch (err) {
      record.status = 'failed'
      record.completedAt = Date.now()
      record.error = err instanceof Error ? err.message : String(err)
      record.activity = 'Failed'
    } finally {
      this.emit(record)
      record.resolveDone(record)
    }
  }

  private async createSession(
    agent: AgentConfig,
    params: AgentRunParams,
    ctx: ExtensionContext
  ): Promise<SubagentSession> {
    const agentDir = this.options.getAgentDir()
    const fileSettingsManager = SettingsManager.create(ctx.cwd, agentDir)
    const workspaceTrusted = this.options.isWorkspaceTrusted()
    const settingsManager = workspaceTrusted
      ? fileSettingsManager
      : SettingsManager.inMemory(fileSettingsManager.getGlobalSettings())
    const wantsExtensions = agent.noExtensions === false
    const noExtensions = agent.isolated === true || !wantsExtensions || !workspaceTrusted
    const resourceLoader = new DefaultResourceLoader({
      cwd: ctx.cwd,
      agentDir,
      settingsManager,
      noExtensions,
      additionalExtensionPaths: wantsExtensions && noExtensions ? [agentDir] : [],
    })
    await resourceLoader.reload()
    // Resolve model: explicit param > agent config default > parent model
    let resolvedModel = params.model ? resolveModel(ctx, params.model) : undefined
    if (params.model && !resolvedModel) throw new Error(`Unknown model override: ${params.model}`)
    if (!resolvedModel && agent.model) resolvedModel = resolveModel(ctx, agent.model)
    const model = resolvedModel ?? ctx.model
    // Resolve thinking level: explicit param > agent config default
    const thinkingLevel = params.thinking ?? agent.thinking
    // Build tool list: start with agent allowlist or all tools, then apply blocklists
    const avoidTools = new Set([
      'Agent',
      'get_subagent_result',
      'steer_subagent',
      ...(agent.disallowedTools ?? []),
    ])
    let tools: string[] | undefined
    if (agent.tools) {
      // Explicit allowlist — filter out recursive/blocked tools
      tools = agent.tools.filter((t) => !avoidTools.has(t))
    } else {
      // No allowlist — use all tools minus blocklist
      tools = undefined // let Pi use defaults
    }
    const { session } = await createAgentSession({
      cwd: ctx.cwd,
      agentDir,
      authStorage: ctx.modelRegistry.authStorage,
      modelRegistry: ctx.modelRegistry,
      model,
      thinkingLevel,
      sessionManager: SessionManager.inMemory(ctx.cwd),
      settingsManager,
      resourceLoader,
      tools,
    })
    return session
  }

  private buildPrompt(agent: AgentConfig, task: string): string {
    const taskBlock = `## Delegated task\n${task}\n\n## Required response\nReturn this exact shape:\n\n## Result\n- **Status:** completed | blocked | failed\n- **Files Modified:** [list]\n- **Files Read:** [list]\n\n## Verification\n- [what was verified and how]\n\n## Summary\n[2-5 sentences]\n\n## Blockers\n- [only if blocked or failed]`
    if (agent.promptMode === 'append') {
      return `${agent.prompt.trim()}\n\n${taskBlock}`
    }
    return `${agent.prompt.trim()}\n\n${taskBlock}`
  }

  private captureEvent(
    record: SubagentRecord,
    session: SubagentSession,
    params: AgentRunParams,
    event: AgentSessionEvent
  ): void {
    if (event.type === 'turn_end') {
      record.turns += 1
      record.activity = `Completed turn ${record.turns}`
      this.emit(record)
      if (params.max_turns && record.turns >= params.max_turns) {
        void session.abort()
      }
      return
    }
    if (event.type === 'tool_execution_start') {
      const toolName = (event as { toolName?: string }).toolName
      record.toolCalls += 1
      record.activity = toolName ? `Using ${toolName}` : 'Using a tool'
      this.emit(record)
      return
    }
    if (event.type === 'message_end') {
      const text = assistantText(event.message)
      if (text) record.resultText = record.resultText ? `${record.resultText}\n\n${text}` : text
      record.activity = text ? 'Wrote output' : record.activity
      this.emit(record)
    }
  }

  private emit(record: SubagentRecord): void {
    try {
      this.options.onSubagentUpdate?.(updateFromRecord(record))
    } catch {
      // UI updates must never affect subagent execution.
    }
  }
}

let manager: SubagentManager | null = null

function getManager(options: RuntimeOptions): SubagentManager {
  manager ??= new SubagentManager(options)
  return manager
}

export function createOpenPiSubagentTools(options: RuntimeOptions): ToolDefinition[] {
  const runtime = getManager(options)
  return [
    {
      name: 'Agent',
      label: 'Agent',
      description:
        'Launch an OpenPi subagent using the Pi SDK. When the user mentions @agent_name (e.g. @explorer, @scout, @worker, @planner, @reviewer, or any .pi/agents/*.md name), delegate to this tool with subagent_type matching the name after @. Use run_in_background for parallel or long-running work; use get_subagent_result to collect results and steer_subagent to redirect running agents.',
      parameters: AgentParams,
      async execute(toolCallId, rawParams, _signal, _onUpdate, ctx) {
        try {
          const params = rawParams as AgentRunParams
          const record = runtime.spawn(params, ctx, toolCallId)
          if (params.run_in_background) {
            return textResult(
              `Agent ID: ${record.id}\nStatus: ${record.status}\nDescription: ${record.description}`,
              summarizeRecord(record)
            )
          }
          const completed = await record.done
          if (completed.status === 'failed') {
            return errorResult(
              `Subagent ${completed.id} failed: ${completed.error ?? 'unknown error'}`,
              summarizeRecord(completed)
            )
          }
          return textResult(
            completed.resultText || `Subagent ${completed.id} completed with no text output.`,
            summarizeRecord(completed)
          )
        } catch (err) {
          return errorResult(err instanceof Error ? err.message : String(err))
        }
      },
    },
    {
      name: 'get_subagent_result',
      label: 'Get Subagent Result',
      description: 'Retrieve the status or completed output of a background OpenPi subagent.',
      parameters: GetResultParams,
      async execute(_toolCallId, rawParams) {
        try {
          const params = rawParams as { agent_id: string; wait?: boolean; verbose?: boolean }
          const record = params.wait
            ? await runtime.wait(params.agent_id)
            : runtime.get(params.agent_id)
          if (!record) return errorResult(`Unknown subagent id: ${params.agent_id}`)
          const summary = summarizeRecord(record)
          const lines = [`Agent ID: ${record.id}`, `Status: ${record.status}`]
          if (record.error) lines.push(`Error: ${record.error}`)
          if (record.resultText) lines.push('', record.resultText)
          if (params.verbose) lines.push('', `Details: ${JSON.stringify(summary, null, 2)}`)
          return record.status === 'failed'
            ? errorResult(lines.join('\n'), summary)
            : textResult(lines.join('\n'), summary)
        } catch (err) {
          return errorResult(err instanceof Error ? err.message : String(err))
        }
      },
    },
    {
      name: 'steer_subagent',
      label: 'Steer Subagent',
      description: 'Send a steering message to a running OpenPi subagent.',
      parameters: SteerParams,
      async execute(_toolCallId, rawParams) {
        const params = rawParams as { agent_id: string; message: string }
        try {
          await runtime.steer(params.agent_id, params.message)
          return textResult(`Steered subagent ${params.agent_id}.`, { agent_id: params.agent_id })
        } catch (err) {
          return errorResult(err instanceof Error ? err.message : String(err), {
            agent_id: params.agent_id,
          })
        }
      },
    },
  ]
}
