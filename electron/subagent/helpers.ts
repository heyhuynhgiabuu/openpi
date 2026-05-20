import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { AgentConfig } from './agents'
import { discoverAgents } from './agents'
import type { RuntimeOptions, SubagentRecord, ToolResult } from './types'

export function createDone(): Pick<SubagentRecord, 'done' | 'resolveDone'> {
  let resolveDone!: (record: SubagentRecord) => void
  const done = new Promise<SubagentRecord>((resolve) => {
    resolveDone = resolve
  })
  return { done, resolveDone }
}

export function textResult(text: string, details: Record<string, unknown> = {}): ToolResult {
  return { content: [{ type: 'text', text }], details }
}

export function errorResult(text: string, details: Record<string, unknown> = {}): ToolResult {
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

export function resolveAgent(
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
  return agents.find((agent) => agent.name === 'worker') ?? agents[0]
}

export function resolveModel(ctx: ExtensionContext, requested?: string): unknown {
  if (!requested) return undefined
  // Split 'provider/modelId' or use just modelId
  const parts = requested.includes('/') ? requested.split('/') : ['', requested]
  const provider = parts[0]
  const modelId = parts[1]
  // Try exact provider/model match first
  if (provider && ctx.modelRegistry) {
    const exact = ctx.modelRegistry.find(provider, modelId)
    if (exact) return exact
  }
  // Fallback: iterate known models via any available means
  // If modelRegistry.find is the only API, we return undefined for unknown models
  return undefined
}

export function summarizeRecord(record: SubagentRecord): Record<string, unknown> {
  return {
    agent_id: record.id,
    status: record.status,
    description: record.description,
    subagent_type: record.subagentType,
    background: record.background,
    turns: record.turns,
    tool_calls: record.toolCalls,
    created_at: record.createdAt,
    started_at: record.startedAt,
    completed_at: record.completedAt,
    result: record.resultText || undefined,
    error: record.error || undefined,
    activity: record.activity || undefined,
  }
}

export function updateFromRecord(record: SubagentRecord): import('./types').OpenPiSubagentUpdate {
  return {
    type: 'openpi_subagent_update',
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
    result: record.resultText || undefined,
    error: record.error || undefined,
    activity: record.activity || undefined,
  }
}
