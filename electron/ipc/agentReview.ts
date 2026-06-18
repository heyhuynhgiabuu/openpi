import type { IpcMain } from 'electron'
import {
  type AgentReviewSummary,
  agentReviewChangeRequestSchema,
  agentReviewClearRequestSchema,
  agentReviewSummarySchema,
  IPC,
} from '../../src/lib/ipc'
import {
  clearAgentReviewChanges,
  getAgentReviewSummary,
  keepAgentReviewChange,
  revertAgentReviewChange,
  revertAgentReviewChanges,
} from '../services/agentReview'

interface AgentReviewIpcDeps {
  ipcMain: IpcMain
  getCwd: () => string | null
}

export function registerAgentReviewIpc(deps: AgentReviewIpcDeps): void {
  deps.ipcMain.handle(IPC.AGENT_REVIEW_LIST, (): AgentReviewSummary => {
    return agentReviewSummarySchema.parse(getAgentReviewSummary(deps.getCwd()))
  })

  deps.ipcMain.handle(IPC.AGENT_REVIEW_KEEP, (_event, raw: unknown): AgentReviewSummary => {
    const { id } = agentReviewChangeRequestSchema.parse(raw)
    keepAgentReviewChange(id)
    return agentReviewSummarySchema.parse(getAgentReviewSummary(deps.getCwd()))
  })

  deps.ipcMain.handle(IPC.AGENT_REVIEW_REVERT, (_event, raw: unknown): AgentReviewSummary => {
    const { id } = agentReviewChangeRequestSchema.parse(raw)
    revertAgentReviewChange(id)
    return agentReviewSummarySchema.parse(getAgentReviewSummary(deps.getCwd()))
  })

  deps.ipcMain.handle(IPC.AGENT_REVIEW_REVERT_ALL, (): AgentReviewSummary => {
    return agentReviewSummarySchema.parse(revertAgentReviewChanges(deps.getCwd()))
  })

  deps.ipcMain.handle(IPC.AGENT_REVIEW_CLEAR, (_event, raw: unknown): AgentReviewSummary => {
    const payload = agentReviewClearRequestSchema.parse(raw)
    return agentReviewSummarySchema.parse(clearAgentReviewChanges(payload.cwd ?? deps.getCwd()))
  })
}
