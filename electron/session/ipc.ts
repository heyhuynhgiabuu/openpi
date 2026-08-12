import * as crypto from 'node:crypto'
import path from 'node:path'
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
  UsageSummary,
  WorkspaceInfo,
} from '../../src/lib/ipc'
import {
  compactSessionSchema,
  forkSessionSchema,
  IPC,
  newSessionSchema,
  openSessionSchema,
  readTaskSessionHistorySchema,
  resolveSubSessionPathSchema,
  sessionBashSchema,
  sessionInfoSchema,
  sessionListOptionsSchema,
  sessionMessagesRequestSchema,
  sessionPromptSchema,
  sessionTreeRequestSchema,
  setSessionNameSchema,
  usageSummaryRequestSchema,
} from '../../src/lib/ipc'
import { createWorktree, generateWorktreePath, getCurrentBranch } from '../git/worktree'
import type { SidecarCommand, SidecarMessage } from '../pi/sidecar'
import {
  readTaskSessionHistory,
  resolveMostRecentSubSessionPath,
  resolveSubSessionPath,
} from '../services/piTaskArtifacts'
import { highRiskShellReason } from '../services/shellEnv'
import { resolveWorkspacePath } from '../services/workspacePath'
import type { SessionState } from '../session/sessionHost'
import type { SessionIndexStore } from '../session/sessionIndex'
import { resolveAuthorizedFile } from '../session/sessionPath'
import { emptyUsageSummary } from '../session/sessionUsage'

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

function authorizedWorkspacePath(deps: SessionsIpcDeps, submittedCwd: string): string {
  const candidate = path.resolve(submittedCwd)
  const active = deps.activeWorkspacePath()
  if (active && path.resolve(active) === candidate) return active
  const known = deps
    .getSessionIndex()
    ?.listWorkspaces()
    .find((workspace) => path.resolve(workspace.path) === candidate)
  if (known) return known.path
  throw new Error('Unknown workspace')
}

function authorizedSessionPath(deps: SessionsIpcDeps, submittedPath: string): string {
  const workspaceRoots = [deps.getSessionState()?.cwd, deps.activeWorkspacePath()]
    .filter((root): root is string => typeof root === 'string')
    .map((root) => ({ anchor: root, root: path.join(root, '.pi', 'artifacts') }))
  const agentDir = deps.getAgentDir()
  return resolveAuthorizedFile(
    submittedPath,
    [{ anchor: agentDir, root: path.join(agentDir, 'sessions') }, ...workspaceRoots],
    ['.jsonl']
  )
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

  deps.ipcMain.handle(
    IPC.GET_USAGE_SUMMARY,
    async (_event, raw: unknown): Promise<UsageSummary> => {
      const request = usageSummaryRequestSchema.parse(raw)
      const sessionIndex = deps.getSessionIndex()
      if (!sessionIndex) return emptyUsageSummary(request)

      const activeSessionPath = deps.getSessionState()?.sessionFile ?? null
      await sessionIndex.refreshSessions(activeSessionPath, request.workspacePath)
      return sessionIndex.getUsageSummary(request)
    }
  )

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
      const { path: submittedPath, limit, beforeEntryId } = sessionMessagesRequestSchema.parse(raw)
      const sessionPath = authorizedSessionPath(deps, submittedPath)
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
      const { path: submittedPath } = sessionTreeRequestSchema.parse(raw)
      const sessionPath = authorizedSessionPath(deps, submittedPath)
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

  deps.ipcMain.handle(IPC.RESOLVE_SUB_SESSION_PATH, async (_event, raw: unknown) => {
    const parsed = resolveSubSessionPathSchema.parse(raw)
    const cwd = authorizedWorkspacePath(deps, parsed.cwd)
    const { taskId } = parsed
    const artifactsDir = resolveWorkspacePath(cwd, '.pi/artifacts', 'read task artifacts')
    return resolveSubSessionPath(artifactsDir, taskId)
  })

  deps.ipcMain.handle(IPC.READ_TASK_SESSION_HISTORY, async (_event, raw: unknown) => {
    const parsed = readTaskSessionHistorySchema.parse(raw)
    const cwd = authorizedWorkspacePath(deps, parsed.cwd)
    return readTaskSessionHistory(cwd)
  })

  deps.ipcMain.handle(IPC.RESOLVE_MOST_RECENT_SUB_SESSION_PATH, async (_event, raw: unknown) => {
    const parsed = readTaskSessionHistorySchema.parse(raw)
    const cwd = authorizedWorkspacePath(deps, parsed.cwd)
    const artifactsDir = resolveWorkspacePath(cwd, '.pi/artifacts', 'read task artifacts')
    return resolveMostRecentSubSessionPath(artifactsDir)
  })

  deps.ipcMain.handle(IPC.OPEN_SESSION, async (_event, raw: unknown) => {
    const { path: submittedPath } = openSessionSchema.parse(raw)
    const sessionPath = authorizedSessionPath(deps, submittedPath)
    const cwd =
      deps.getSessionIndex()?.getSessionWorkspace(sessionPath) ?? deps.getSessionState()?.cwd
    if (!cwd) return
    await deps.startSession(cwd, { sessionFile: sessionPath })
  })

  deps.ipcMain.handle(IPC.NEW_SESSION, async (_event, raw: unknown) => {
    const { cwd, mode, baseBranch } = newSessionSchema.parse(raw)
    const submittedWorkspace =
      cwd ?? deps.getSessionState()?.cwd ?? deps.getSessionIndex()?.getLastWorkspace()
    const workspacePath = submittedWorkspace
      ? authorizedWorkspacePath(deps, submittedWorkspace)
      : null
    if (!workspacePath) return

    if (mode === 'worktree') {
      const threadId = crypto.randomUUID()
      const wtPath = generateWorktreePath(workspacePath, threadId)
      const branch = baseBranch ?? (await getCurrentBranch(workspacePath))
      try {
        await createWorktree({
          repoPath: workspacePath,
          baseBranch: branch,
          worktreePath: wtPath,
        })
      } catch (err) {
        console.error('[worktree] creation failed:', err)
        throw err
      }
      await deps.startSession(wtPath, { worktreePath: wtPath, rootCwd: workspacePath })
    } else {
      await deps.startSession(workspacePath)
    }
  })

  deps.ipcMain.handle(IPC.SET_SESSION_NAME, (_event, raw: unknown) => {
    if (!deps.getSessionState()) return
    const { name } = setSessionNameSchema.parse(raw)
    deps.sendSidecar({ type: 'set_session_name', name })
  })

  deps.ipcMain.handle(IPC.FORK_SESSION, async (_event, raw: unknown) => {
    if (!deps.getSessionState()) return
    const { entryId } = forkSessionSchema.parse(raw)
    const current = deps.getSessionState()
    if (!current) return
    const workspaceTrusted = deps.getSessionIndex()?.isWorkspaceTrusted(current.cwd) ?? false
    deps.suspendSessionValues()
    try {
      const response = await deps.requestSidecar<
        Extract<SidecarMessage, { type: 'session_ready' }>
      >({
        type: 'fork_session',
        requestId: deps.createRequestId(),
        entryId,
        workspaceTrusted,
      })
      const ready = deps.normalizeSessionReady(response.payload as SessionReady)
      deps.applySessionValues(ready)
      await deps.refreshSessionIndex()
    } catch (error) {
      deps.restoreSessionValues(current)
      throw error
    }
  })

  deps.ipcMain.handle(IPC.COMPACT_SESSION, async (_event, raw: unknown) => {
    if (!deps.getSessionState()) return
    const { customInstructions } = compactSessionSchema.parse(raw)
    await deps
      .requestSidecar<
        | Extract<SidecarMessage, { type: 'compact_result' }>
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
    deps.suspendSessionValues()
    const response = await deps.requestSidecar<Extract<SidecarMessage, { type: 'session_ready' }>>({
      type: 'reload_session',
      requestId: deps.createRequestId(),
    })
    const ready = deps.normalizeSessionReady(response.payload as SessionReady)
    deps.applySessionValues(ready)
    await deps.refreshSessionIndex()
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
