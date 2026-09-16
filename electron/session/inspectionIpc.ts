/**
 * inspectionIpc.ts — read-model handlers over session data: history page,
 * tree, trajectory ledger, usage summary, and pi-task sub-session lookup,
 * plus the session export bundle. Read-only: every path goes through the
 * shared session authorization (deny-only) and the renderer never parses
 * JSONL itself.
 */
import path from 'node:path'
import { dialog, type BrowserWindow, type IpcMain, shell } from 'electron'
import type {
  SessionHistoryPage,
  SessionTreeResponse,
  SessionTrajectoryResponse,
  UsageSummary,
} from '../../src/lib/ipc'
import {
  exportSessionBundleResultSchema,
  IPC,
  readTaskSessionHistorySchema,
  resolveSubSessionPathSchema,
  sessionMessagesRequestSchema,
  sessionTreeRequestSchema,
  usageSummaryRequestSchema,
} from '../../src/lib/ipc'
import {
  readTaskSessionHistory,
  resolveMostRecentSubSessionPath,
  resolveSubSessionPath,
} from '../services/piTaskArtifacts'
import { buildSessionExportBundle, SessionExportError } from '../services/sessionExport'
import { resolveWorkspacePath } from '../services/workspacePath'
import {
  authorizedSessionPathIfPresent,
  authorizedWorkspacePath,
  type SessionAuthDeps,
} from './sessionAuth'
import { emptyHistoryPage } from './sessionEntries'
import { emptyUsageSummary } from './sessionUsage'

interface SessionInspectionIpcDeps extends SessionAuthDeps {
  ipcMain: IpcMain
  getMainWindow: () => BrowserWindow | null
}

export function registerSessionInspectionIpc(deps: SessionInspectionIpcDeps): void {
  deps.ipcMain.handle(
    IPC.GET_SESSION_MESSAGES,
    async (_event, raw: unknown): Promise<SessionHistoryPage> => {
      const {
        path: submittedPath,
        limit,
        beforeEntryId,
        leafId,
      } = sessionMessagesRequestSchema.parse(raw)
      const sessionPath = authorizedSessionPathIfPresent(deps, submittedPath)
      // No file yet means the session has no persisted history to load.
      if (!sessionPath) return emptyHistoryPage(limit ?? 0)
      return (
        (await deps
          .getSessionIndex()
          ?.getSessionMessages(sessionPath, { limit, beforeEntryId, leafId })) ??
        emptyHistoryPage(limit ?? 0)
      )
    }
  )

  deps.ipcMain.handle(
    IPC.GET_SESSION_TREE,
    async (_event, raw: unknown): Promise<SessionTreeResponse> => {
      const { path: submittedPath, leafId } = sessionTreeRequestSchema.parse(raw)
      const sessionPath = authorizedSessionPathIfPresent(deps, submittedPath)
      // No file yet means there is no tree to build.
      if (!sessionPath) {
        return {
          sessionPath: path.resolve(submittedPath),
          branches: [],
          forkPoints: [],
          activeLeafId: null,
        }
      }
      return (
        deps.getSessionIndex()?.getSessionTree(sessionPath, leafId) ?? {
          sessionPath,
          branches: [],
          forkPoints: [],
          activeLeafId: null,
        }
      )
    }
  )

  deps.ipcMain.handle(
    IPC.GET_SESSION_TRAJECTORY,
    async (_event, raw: unknown): Promise<SessionTrajectoryResponse> => {
      const { path: submittedPath, leafId } = sessionTreeRequestSchema.parse(raw)
      const sessionPath = authorizedSessionPathIfPresent(deps, submittedPath)
      if (!sessionPath) {
        return { sessionPath: path.resolve(submittedPath), activeLeafId: null, rows: [] }
      }
      return (
        deps.getSessionIndex()?.getSessionTrajectory(sessionPath, leafId) ?? {
          sessionPath,
          activeLeafId: null,
          rows: [],
        }
      )
    }
  )

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

  deps.ipcMain.handle(IPC.EXPORT_SESSION_BUNDLE, async () => {
    const state = deps.getSessionState()
    if (!state?.sessionFile) {
      return exportSessionBundleResultSchema.parse({
        status: 'error',
        message: 'No active session to export.',
      })
    }
    const mainWindow = deps.getMainWindow()
    if (!mainWindow) {
      return exportSessionBundleResultSchema.parse({ status: 'cancelled' })
    }
    let picked: Awaited<ReturnType<typeof dialog.showOpenDialog>>
    try {
      picked = await dialog.showOpenDialog(mainWindow, {
        title: 'Export Session Bundle',
        message: 'Choose a folder to create the session export bundle in',
        properties: ['openDirectory', 'createDirectory'],
        buttonLabel: 'Export Here',
      })
      if (picked.canceled || !picked.filePaths[0]) {
        return exportSessionBundleResultSchema.parse({ status: 'cancelled' })
      }
      const bundle = buildSessionExportBundle({
        agentDir: deps.getAgentDir(),
        workspaceCwd: state.cwd ?? deps.activeWorkspacePath(),
        sessionPath: state.sessionFile,
        outRoot: picked.filePaths[0],
      })
      shell.showItemInFolder(bundle.outDir)
      return exportSessionBundleResultSchema.parse({
        status: 'exported',
        outDir: bundle.outDir,
        sessionId: bundle.sessionId,
        files: bundle.files,
        subSessionTaskIds: bundle.subSessionTaskIds,
        warnings: bundle.warnings,
      })
    } catch (err) {
      const message =
        err instanceof SessionExportError
          ? err.message
          : `Session export failed: ${err instanceof Error ? err.message : String(err)}`
      return exportSessionBundleResultSchema.parse({ status: 'error', message })
    }
  })
}
