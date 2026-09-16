/**
 * ipc.ts — session IPC registrar: core messaging/steering, active-session
 * guards, and sidebar listing. Domain handlers live beside it:
 *   inspectionIpc.ts — read models (history, tree, trajectory, usage,
 *                      sub-sessions) and the export bundle
 *   lifecycleIpc.ts  — active-session mutations (open/new/fork/navigate/
 *                      compact/reload/name/info/copy)
 *   sessionAuth.ts   — shared deny-only path authorization
 * The renderer only ever talks to these typed channels.
 */
import { type BrowserWindow, dialog, type IpcMain } from 'electron'
import type {
  BashExecutionResult,
  OutputLine,
  SessionListItem,
  SessionReady,
  SessionStats,
  WorkspaceInfo,
} from '../../src/lib/ipc'
import {
  IPC,
  sessionBashSchema,
  sessionListOptionsSchema,
  sessionPromptSchema,
} from '../../src/lib/ipc'
import type { SidecarCommand, SidecarMessage } from '../pi/sidecar'
import { highRiskShellReason } from '../services/shellEnv'
import { registerSessionInspectionIpc } from './inspectionIpc'
import { registerSessionLifecycleIpc } from './lifecycleIpc'
import type { SessionState } from './sessionHost'
import type { SessionIndexStore } from './sessionIndex'

interface ConfirmMutationOptions {
  title: string
  message: string
  detail: string
}

interface SessionsIpcDeps {
  ipcMain: IpcMain
  getMainWindow: () => BrowserWindow | null
  getAgentDir: () => string
  outputBuffer: readonly OutputLine[]
  startSession: (
    cwd: string,
    options?: {
      sessionFile?: string
      forkEntryId?: string
      worktreePath?: string
      rootCwd?: string
    }
  ) => Promise<void>
  emitSessionError: (message: string) => void
  ensureActiveSession: () => Promise<SessionState | null>
  getSessionState: () => SessionState | null
  getSessionIndex: () => SessionIndexStore | null
  activeWorkspacePath: () => string | null
  createRequestId: () => string
  sendSidecar: (message: SidecarCommand) => void
  requestSidecar: <T extends SidecarMessage>(
    message: SidecarCommand & { requestId: string }
  ) => Promise<T>
  buildWorkbenchContextPrefix: () => string | null
  confirmHighRiskMutation: (options: ConfirmMutationOptions) => Promise<boolean>
  refreshSessionIndex: () => Promise<void>
  normalizeSessionReady: (payload: SessionReady) => SessionReady
  applySessionValues: (ready: SessionReady) => void
  suspendSessionValues: () => void
  restoreSessionValues: (state: SessionState) => void
}

function injectWorkbenchPrefix(
  contextPrefix: string | undefined,
  buildWorkbenchContextPrefix: () => string | null
): string | undefined {
  const workbenchPrefix = buildWorkbenchContextPrefix()
  if (!workbenchPrefix) return contextPrefix
  return contextPrefix ? `${workbenchPrefix}\n${contextPrefix}` : workbenchPrefix
}

function emptySessionStats(): SessionStats {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cost: 0,
    contextUsagePercent: null,
    contextTokens: null,
    contextWindow: null,
    sessionFile: null,
    sessionId: null,
    isStreaming: false,
  }
}

export function registerSessionsIpc(deps: SessionsIpcDeps): void {
  registerSessionInspectionIpc(deps)
  registerSessionLifecycleIpc(deps)

  deps.ipcMain.handle(IPC.SEND_PROMPT, async (_event, raw: unknown): Promise<void> => {
    const request = raw as { text?: string }
    if (request.text) {
      deps.sendSidecar({ type: 'prompt', text: request.text })
    }
  })

  deps.ipcMain.handle(IPC.GET_OUTPUT_BUFFER, (): OutputLine[] => [...deps.outputBuffer])

  deps.ipcMain.handle(IPC.PICK_WORKSPACE, async () => {
    const mainWindow = deps.getMainWindow()
    if (!mainWindow) return { cancelled: true }
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Open Workspace',
      properties: ['openDirectory'],
      buttonLabel: 'Open Workspace',
    })
    if (result.canceled || !result.filePaths[0]) {
      return { cancelled: true }
    }
    const workspacePath = result.filePaths[0]
    try {
      await deps.startSession(workspacePath)
    } catch (err) {
      deps.emitSessionError(err instanceof Error ? err.message : String(err))
    }
    return { cancelled: false, path: workspacePath }
  })

  deps.ipcMain.handle(IPC.SESSION_PROMPT, async (_event, raw: unknown) => {
    if (!(await deps.ensureActiveSession())) return
    const { text, contextPrefix } = sessionPromptSchema.parse(raw)
    deps.sendSidecar({
      type: 'prompt',
      text,
      contextPrefix: injectWorkbenchPrefix(contextPrefix, deps.buildWorkbenchContextPrefix),
    })
  })

  deps.ipcMain.handle(IPC.SESSION_STEER, async (_event, raw: unknown) => {
    if (!(await deps.ensureActiveSession())) return
    const { text, contextPrefix } = sessionPromptSchema.parse(raw)
    deps.sendSidecar({
      type: 'steer',
      text,
      contextPrefix: injectWorkbenchPrefix(contextPrefix, deps.buildWorkbenchContextPrefix),
    })
  })

  deps.ipcMain.handle(IPC.SESSION_FOLLOW_UP, async (_event, raw: unknown) => {
    if (!(await deps.ensureActiveSession())) return
    const { text, contextPrefix } = sessionPromptSchema.parse(raw)
    deps.sendSidecar({
      type: 'follow_up',
      text,
      contextPrefix: injectWorkbenchPrefix(contextPrefix, deps.buildWorkbenchContextPrefix),
    })
  })

  deps.ipcMain.handle(
    IPC.SESSION_BASH,
    async (_event, raw: unknown): Promise<BashExecutionResult | undefined> => {
      if (!(await deps.ensureActiveSession())) return undefined
      const { command, excludeFromContext } = sessionBashSchema.parse(raw)
      const riskReason = highRiskShellReason(command)
      if (riskReason) {
        const approved = await deps.confirmHighRiskMutation({
          title: 'Confirm high-risk shell command',
          message: 'This shell command can mutate or delete data.',
          detail: `${riskReason}\n\nCommand:\n${command}`,
        })
        if (!approved) {
          return {
            output: 'Command cancelled by user.',
            exitCode: 130,
            cancelled: true,
            truncated: false,
          }
        }
      }
      const requestId = deps.createRequestId()
      const response = await deps.requestSidecar<Extract<SidecarMessage, { type: 'bash_result' }>>({
        type: 'execute_bash',
        requestId,
        command,
        excludeFromContext,
      })
      setTimeout(() => {
        void deps.refreshSessionIndex()
      }, 0)
      return response.result as BashExecutionResult
    }
  )

  deps.ipcMain.handle(IPC.SESSION_ABORT, async () => {
    if (!deps.getSessionState()) return
    deps.sendSidecar({ type: 'abort' })
  })

  deps.ipcMain.handle(IPC.GET_SESSION_STATS, async (): Promise<SessionStats> => {
    if (!deps.getSessionState()) return emptySessionStats()
    const response = await deps.requestSidecar<Extract<SidecarMessage, { type: 'stats_result' }>>({
      type: 'get_stats',
      requestId: deps.createRequestId(),
    })
    return response.stats as SessionStats
  })

  deps.ipcMain.handle(IPC.GET_WORKSPACES, async (): Promise<WorkspaceInfo[]> => {
    return deps.getSessionIndex()?.listWorkspaces() ?? []
  })

  deps.ipcMain.handle(
    IPC.GET_SESSIONS,
    async (_event, raw: unknown): Promise<SessionListItem[]> => {
      const options = sessionListOptionsSchema.parse(raw)
      const workspacePath = options.workspacePath ?? deps.activeWorkspacePath()
      if (!workspacePath) return []

      const sessionIndex = deps.getSessionIndex()
      if (!sessionIndex) return []

      const activeSessionPath = deps.getSessionState()?.sessionFile ?? null
      await sessionIndex.refreshSessions(activeSessionPath, workspacePath)
      return sessionIndex.listSessions(options, activeSessionPath, workspacePath)
    }
  )
}

export type { SessionsIpcDeps }
