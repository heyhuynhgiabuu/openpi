import type { IpcMain } from 'electron'
import {
  type AgentReviewSummary,
  agentReviewChangeRequestSchema,
  agentReviewClearRequestSchema,
  agentReviewHunkRequestSchema,
  agentReviewSummarySchema,
  IPC,
} from '../../src/lib/ipc'
import {
  clearAgentReviewChanges,
  keepAgentReviewChange,
  keepAgentReviewHunk,
  revertAgentReviewChange,
  revertAgentReviewChanges,
  revertAgentReviewHunk,
} from '../services/agentReview'
import { getAgentReviewSummary } from '../services/agentReviewStore'

interface AgentReviewIpcDeps {
  ipcMain: IpcMain
  getCwd: () => string | null
}

export function registerAgentReviewIpc(deps: AgentReviewIpcDeps): void {
  const summarize = (): AgentReviewSummary =>
    agentReviewSummarySchema.parse(getAgentReviewSummary(deps.getCwd()))

  deps.ipcMain.handle(IPC.AGENT_REVIEW_LIST, summarize)

  deps.ipcMain.handle(IPC.AGENT_REVIEW_KEEP, (_event, raw: unknown): AgentReviewSummary => {
    const { id } = agentReviewChangeRequestSchema.parse(raw)
    keepAgentReviewChange(id)
    return summarize()
  })

  deps.ipcMain.handle(IPC.AGENT_REVIEW_REVERT, (_event, raw: unknown): AgentReviewSummary => {
    const { id } = agentReviewChangeRequestSchema.parse(raw)
    revertAgentReviewChange(id)
    return summarize()
  })

  deps.ipcMain.handle(IPC.AGENT_REVIEW_KEEP_HUNK, (_event, raw: unknown): AgentReviewSummary => {
    const { id, index } = agentReviewHunkRequestSchema.parse(raw)
    keepAgentReviewHunk(id, index)
    return summarize()
  })

  deps.ipcMain.handle(IPC.AGENT_REVIEW_REVERT_HUNK, (_event, raw: unknown): AgentReviewSummary => {
    const { id, index } = agentReviewHunkRequestSchema.parse(raw)
    revertAgentReviewHunk(id, index)
    return summarize()
  })

  deps.ipcMain.handle(IPC.AGENT_REVIEW_REVERT_ALL, (): AgentReviewSummary => {
    return agentReviewSummarySchema.parse(revertAgentReviewChanges(deps.getCwd()))
  })

  deps.ipcMain.handle(IPC.AGENT_REVIEW_CLEAR, (_event, raw: unknown): AgentReviewSummary => {
    const payload = agentReviewClearRequestSchema.parse(raw)
    return agentReviewSummarySchema.parse(clearAgentReviewChanges(payload.cwd ?? deps.getCwd()))
  })
}
