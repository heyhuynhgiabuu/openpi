import { type BrowserWindow, dialog, type IpcMain } from 'electron'
import type {
  BashExecutionResult,
  OutputLine,
  SessionHistoryPage,
  SessionInfo,
  SessionListItem,
  SessionReady,
  SessionStats,
  SessionTreeResponse,
  WorkspaceInfo,
} from '../../src/lib/ipc'
import {
  compactSessionSchema,
  forkSessionSchema,
  IPC,
  newSessionSchema,
  openSessionSchema,
  sessionBashSchema,
  sessionInfoSchema,
  sessionListOptionsSchema,
  sessionMessagesRequestSchema,
  sessionPromptSchema,
  sessionTreeRequestSchema,
  setSessionNameSchema,
} from '../../src/lib/ipc'
import type { SidecarCommand, SidecarMessage } from '../pi/sidecar'
import { highRiskShellReason } from '../services/shellEnv'
import type { SessionState } from '../session/sessionHost'
import type { SessionIndexStore } from '../session/sessionIndex'

interface ConfirmMutationOptions {
  title: string
  message: string
  detail: string
}

interface SessionsIpcDeps {
  ipcMain: IpcMain
  getMainWindow: () => BrowserWindow | null
  outputBuffer: readonly OutputLine[]
  startSession: (cwd: string, options?: { sessionFile?: string }) => Promise<void>
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

function injectWorkbenchPrefix(
  contextPrefix: string | undefined,
  buildWorkbenchContextPrefix: () => string | null
): string | undefined {
  const workbenchPrefix = buildWorkbenchContextPrefix()
  if (!workbenchPrefix) return contextPrefix
  return contextPrefix ? `${workbenchPrefix}\n${contextPrefix}` : workbenchPrefix
}

export function registerSessionsIpc(deps: SessionsIpcDeps): void {
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

  deps.ipcMain.handle(
    IPC.GET_SESSION_MESSAGES,
    async (_event, raw: unknown): Promise<SessionHistoryPage> => {
      const { path: sessionPath, limit, beforeEntryId } = sessionMessagesRequestSchema.parse(raw)
      return (
        (await deps
          .getSessionIndex()
          ?.getSessionMessages(sessionPath, { limit, beforeEntryId })) ?? {
          messages: [],
          hasMoreBefore: false,
          nextBeforeEntryId: null,
          limit: limit ?? 0,
        }
      )
    }
  )

  deps.ipcMain.handle(
    IPC.GET_SESSION_TREE,
    async (_event, raw: unknown): Promise<SessionTreeResponse> => {
      const { path: sessionPath } = sessionTreeRequestSchema.parse(raw)
      return (
        deps.getSessionIndex()?.getSessionTree(sessionPath) ?? {
          sessionPath,
          branches: [],
          forkPoints: [],
          activeLeafId: null,
        }
      )
    }
  )

  deps.ipcMain.handle(IPC.OPEN_SESSION, async (_event, raw: unknown) => {
    const { path: sessionPath } = openSessionSchema.parse(raw)
    const cwd =
      deps.getSessionIndex()?.getSessionWorkspace(sessionPath) ?? deps.getSessionState()?.cwd
    if (!cwd) return
    await deps.startSession(cwd, { sessionFile: sessionPath })
  })

  deps.ipcMain.handle(IPC.NEW_SESSION, async (_event, raw: unknown) => {
    const { cwd } = newSessionSchema.parse(raw)
    const workspacePath =
      cwd ?? deps.getSessionState()?.cwd ?? deps.getSessionIndex()?.getLastWorkspace()
    if (!workspacePath) return
    await deps.startSession(workspacePath)
  })

  deps.ipcMain.handle(IPC.SET_SESSION_NAME, (_event, raw: unknown) => {
    if (!deps.getSessionState()) return
    const { name } = setSessionNameSchema.parse(raw)
    deps.sendSidecar({ type: 'set_session_name', name })
  })

  deps.ipcMain.handle(IPC.FORK_SESSION, async (_event, raw: unknown) => {
    if (!deps.getSessionState()) return
    const { entryId } = forkSessionSchema.parse(raw)
    const response = await deps.requestSidecar<Extract<SidecarMessage, { type: 'session_ready' }>>({
      type: 'fork_session',
      requestId: deps.createRequestId(),
      entryId,
    })
    const ready = deps.normalizeSessionReady(response.payload as SessionReady)
    deps.applySessionValues(ready)
    await deps.refreshSessionIndex()
  })

  deps.ipcMain.handle(IPC.COMPACT_SESSION, async (_event, raw: unknown) => {
    if (!deps.getSessionState()) return
    const { customInstructions } = compactSessionSchema.parse(raw)
    await deps
      .requestSidecar<
        | Extract<SidecarMessage, { type: 'compaction_end' }>
        | Extract<SidecarMessage, { type: 'error' }>
      >({
        type: 'compact',
        requestId: deps.createRequestId(),
        ...(customInstructions ? { customInstructions } : {}),
      })
      .catch((err) => {
        // The Pi SDK emits `compaction_end` (success or with errorMessage)
        // as a session event, so the renderer already sees the outcome.
        // We swallow the request error here to avoid a noisy toast.
        if (err && typeof err === 'object' && 'message' in err) return
        throw err
      })
  })

  deps.ipcMain.handle(IPC.RELOAD_SESSION, async () => {
    if (!deps.getSessionState()) return
    await deps.requestSidecar<
      | Extract<SidecarMessage, { type: 'session_event' }>
      | Extract<SidecarMessage, { type: 'error' }>
    >({
      type: 'reload_session',
      requestId: deps.createRequestId(),
    })
  })

  deps.ipcMain.handle(IPC.GET_SESSION_INFO, async (): Promise<SessionInfo | null> => {
    if (!deps.getSessionState()) return null
    const response = await deps.requestSidecar<
      Extract<SidecarMessage, { type: 'session_info_result' }>
    >({
      type: 'get_session_info',
      requestId: deps.createRequestId(),
    })
    return sessionInfoSchema.parse(response.info)
  })

  deps.ipcMain.handle(IPC.COPY_LAST_ASSISTANT_TEXT, async () => {
    if (!deps.getSessionState()) return
    const response = await deps.requestSidecar<
      Extract<SidecarMessage, { type: 'last_assistant_text_result' }>
    >({
      type: 'copy_last_assistant_text',
      requestId: deps.createRequestId(),
    })
    if (response.text) {
      const { clipboard } = await import('electron')
      clipboard.writeText(response.text)
    }
    return response.text
  })
}
