/**
 * lifecycleIpc.ts — handlers that mutate or replace the ACTIVE session:
 * open, new (incl. worktrees), rename, fork, tree navigation, compaction,
 * reload, info, and clipboard copy. All sidecar commands and session-value
 * swaps flow through the same deps the core registrar owns.
 */
import crypto from 'node:crypto'
import { type IpcMain } from 'electron'
import type { NavigateSessionTreeResult, SessionInfo, SessionReady } from '../../src/lib/ipc'
import {
  compactSessionSchema,
  forkSessionSchema,
  IPC,
  navigateSessionTreeRequestSchema,
  navigateSessionTreeResultSchema,
  newSessionSchema,
  openSessionSchema,
  sessionInfoSchema,
  setSessionNameSchema,
} from '../../src/lib/ipc'
import { createWorktree, generateWorktreePath, getCurrentBranch } from '../git/worktree'
import type { SidecarCommand, SidecarMessage } from '../pi/sidecar'
import type { SessionState } from './sessionHost'
import {
  authorizedSessionPath,
  authorizedSessionPathIfPresent,
  authorizedWorkspacePath,
  type SessionAuthDeps,
} from './sessionAuth'

interface SessionLifecycleIpcDeps extends SessionAuthDeps {
  ipcMain: IpcMain
  startSession: (
    cwd: string,
    options?: {
      sessionFile?: string
      forkEntryId?: string
      worktreePath?: string
      rootCwd?: string
    }
  ) => Promise<void>
  createRequestId: () => string
  sendSidecar: (message: SidecarCommand) => void
  requestSidecar: <T extends SidecarMessage>(
    message: SidecarCommand & { requestId: string }
  ) => Promise<T>
  refreshSessionIndex: () => Promise<void>
  normalizeSessionReady: (payload: SessionReady) => SessionReady
  applySessionValues: (ready: SessionReady) => void
  suspendSessionValues: () => void
  restoreSessionValues: (state: SessionState) => void
}

export function registerSessionLifecycleIpc(deps: SessionLifecycleIpcDeps): void {
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

  deps.ipcMain.handle(
    IPC.NAVIGATE_SESSION_TREE,
    async (_event, raw: unknown): Promise<NavigateSessionTreeResult> => {
      const { path: submittedPath, entryId } = navigateSessionTreeRequestSchema.parse(raw)
      const sessionPath = authorizedSessionPathIfPresent(deps, submittedPath)
      const current = deps.getSessionState()
      // Only the session main is hosting can move its leaf.
      if (!sessionPath || !current || current.sessionFile !== sessionPath) {
        throw new Error('That session is not open, so its branch cannot be switched.')
      }
      const response = await deps.requestSidecar<
        Extract<SidecarMessage, { type: 'navigate_tree_result' }>
      >({
        type: 'navigate_tree',
        requestId: deps.createRequestId(),
        entryId,
      })
      return navigateSessionTreeResultSchema.parse(response.result)
    }
  )

  deps.ipcMain.handle(IPC.COMPACT_SESSION, async (_event, raw: unknown) => {
    if (!deps.getSessionState()) return
    const { customInstructions } = compactSessionSchema.parse(raw)
    const command: Extract<SidecarCommand, { type: 'compact' }> = {
      type: 'compact',
      requestId: deps.createRequestId(),
    }
    if (customInstructions) command.customInstructions = customInstructions
    await deps
      .requestSidecar<
        | Extract<SidecarMessage, { type: 'compact_result' }>
        | Extract<SidecarMessage, { type: 'error' }>
      >(command)
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
