import { randomUUID } from 'node:crypto'
import type { Api, Model } from '@earendil-works/pi-ai'
import type { AgentSessionEvent, ExtensionContext } from '@earendil-works/pi-coding-agent'
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import type { AgentConfig } from './agents'
import { assistantText, createDone, resolveAgent, resolveModel, updateFromRecord } from './helpers'
import type {
  AgentRunParams,
  QueueItem,
  RuntimeOptions,
  SubagentRecord,
  SubagentSession,
} from './types'

export { assistantText }

export class SubagentManager {
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
      record.unsubscribe = session.subscribe((event: AgentSessionEvent) => {
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
    const model = (resolvedModel ?? ctx.model) as Model<Api> | undefined
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
