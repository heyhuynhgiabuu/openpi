import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import type {
  AgentSession,
  createAgentSession,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type { AgentConfig } from './agents'

export type { AgentToolResult }
export type ToolResult = AgentToolResult<Record<string, unknown>>

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
export type SubagentStatus = 'queued' | 'running' | 'completed' | 'failed'

export type RuntimeOptions = {
  getAgentDir: () => string
  isWorkspaceTrusted: () => boolean
  maxConcurrent?: number
  onSubagentUpdate?: (update: OpenPiSubagentUpdate) => void
}

export type AgentRunParams = {
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

export type SubagentRecord = {
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
  session?: AgentSession
  unsubscribe?: () => void
  done: Promise<SubagentRecord>
  resolveDone: (record: SubagentRecord) => void
}

export type SubagentSession = Awaited<ReturnType<typeof createAgentSession>>['session']

export type QueueItem = {
  record: SubagentRecord
  agent: AgentConfig
  params: AgentRunParams
  ctx: ExtensionContext
}
