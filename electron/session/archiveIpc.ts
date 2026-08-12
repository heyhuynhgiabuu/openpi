import fs from 'node:fs'
import path from 'node:path'
import { type IpcMain, shell } from 'electron'
import type { ArchivedSessionItem, ArchiveSessionsResult, OutputLine } from '../../src/lib/ipc'
import {
  archiveSessionsRequestSchema,
  deleteSessionRequestSchema,
  deleteSessionsRequestSchema,
  IPC,
  unarchiveSessionsRequestSchema,
} from '../../src/lib/ipc'
import { moveSessionFileNoReplace, resolveAuthorizedSessionFile } from './sessionPath'

interface SessionArchiveIpcDeps {
  ipcMain: IpcMain
  getAgentDir: () => string
  getActiveSessionFile: () => string | null
  getActiveCwd: () => string | null
  startSession: (cwd: string) => Promise<void>
  refreshSessionIndex: () => Promise<void>
  emitOutputLine: (line: OutputLine) => void
}

export function registerSessionArchiveIpc(deps: SessionArchiveIpcDeps): void {
  deps.ipcMain.handle(
    IPC.ARCHIVE_SESSIONS,
    async (_event, raw: unknown): Promise<ArchiveSessionsResult> => {
      const { paths } = archiveSessionsRequestSchema.parse(raw)
      let archived = 0
      let skipped = 0

      const activeFile = deps.getActiveSessionFile()
      const activeCwd = deps.getActiveCwd()
      const willArchiveActive = activeFile != null && paths.includes(activeFile)
      if (willArchiveActive && activeCwd) {
        try {
          await deps.startSession(activeCwd)
        } catch {
          /* non-fatal */
        }
      }

      for (const submittedPath of paths) {
        try {
          const filePath = resolveAuthorizedSessionFile(deps.getAgentDir(), submittedPath, [
            '.jsonl',
          ])
          const archivedPath = `${filePath}.archived`
          moveSessionFileNoReplace(filePath, archivedPath)
          archived++
        } catch (err) {
          skipped++
          deps.emitOutputLine({
            level: 'warn',
            text: `[archive] rename failed: ${String(err)}`,
            ts: Date.now(),
          })
        }
      }

      await deps.refreshSessionIndex()
      return { archived, skipped }
    }
  )

  deps.ipcMain.handle(IPC.LIST_ARCHIVED_SESSIONS, (): ArchivedSessionItem[] => {
    const sessionsDir = path.join(deps.getAgentDir(), 'sessions')
    const results: ArchivedSessionItem[] = []

    let subdirs: string[]
    try {
      subdirs = fs.readdirSync(sessionsDir)
    } catch {
      return []
    }

    for (const dirName of subdirs) {
      const dirPath = path.join(sessionsDir, dirName)
      let stat: fs.Stats
      try {
        stat = fs.lstatSync(dirPath)
      } catch {
        continue
      }
      if (!stat.isDirectory()) continue

      let files: string[]
      try {
        files = fs.readdirSync(dirPath)
      } catch {
        continue
      }

      for (const file of files) {
        if (!file.endsWith('.jsonl.archived')) continue
        const submittedPath = path.join(dirPath, file)
        let archivedPath: string
        let mtime: number
        try {
          archivedPath = resolveAuthorizedSessionFile(deps.getAgentDir(), submittedPath, [
            '.jsonl.archived',
          ])
          mtime = fs.lstatSync(archivedPath).mtimeMs
        } catch {
          continue
        }
        const originalPath = archivedPath.slice(0, -'.archived'.length)
        const inner = dirName.replace(/^--/, '').replace(/--$/, '')
        const segments = inner.split('-').filter((segment) => segment.length > 0)
        const workspaceName = segments[segments.length - 1] ?? dirName
        results.push({ archivedPath, originalPath, workspaceName, archivedAt: mtime })
      }
    }

    return results.sort((a, b) => b.archivedAt - a.archivedAt)
  })

  deps.ipcMain.handle(IPC.UNARCHIVE_SESSIONS, async (_event, raw: unknown): Promise<void> => {
    const { paths } = unarchiveSessionsRequestSchema.parse(raw)
    for (const submittedPath of paths) {
      try {
        const archivedPath = resolveAuthorizedSessionFile(deps.getAgentDir(), submittedPath, [
          '.jsonl.archived',
        ])
        const originalPath = archivedPath.slice(0, -'.archived'.length)
        moveSessionFileNoReplace(archivedPath, originalPath)
      } catch {
        /* skip */
      }
    }
    await deps.refreshSessionIndex()
  })

  deps.ipcMain.handle(
    IPC.DELETE_SESSIONS,
    async (_event, raw: unknown): Promise<{ deleted: number; failed: number }> => {
      const { paths } = deleteSessionsRequestSchema.parse(raw)
      let deleted = 0
      let failed = 0

      for (const submittedPath of paths) {
        try {
          const filePath = resolveAuthorizedSessionFile(deps.getAgentDir(), submittedPath, [
            '.jsonl.archived',
          ])
          await shell.trashItem(filePath)
          deleted++
        } catch (err) {
          console.warn(`[delete-sessions] failed to trash ${submittedPath}: ${String(err)}`)
          failed++
        }
      }
      await deps.refreshSessionIndex()
      return { deleted, failed }
    }
  )

  deps.ipcMain.handle(
    IPC.DELETE_SESSION,
    async (_event, raw: unknown): Promise<{ deleted: number; failed: number }> => {
      const { path: sessionPath } = deleteSessionRequestSchema.parse(raw)
      let deleted = 0
      let failed = 0

      try {
        const filePath = resolveAuthorizedSessionFile(deps.getAgentDir(), sessionPath, [
          '.jsonl',
          '.jsonl.archived',
        ])
        if (filePath.endsWith('.jsonl.archived')) {
          await shell.trashItem(filePath)
        } else {
          const archivedPath = `${filePath}.archived`
          moveSessionFileNoReplace(filePath, archivedPath)
          await shell.trashItem(archivedPath)
        }
        deleted++
      } catch (err) {
        console.warn(`[delete-session] failed to delete ${sessionPath}: ${String(err)}`)
        failed++
      }
      await deps.refreshSessionIndex()
      return { deleted, failed }
    }
  )
}
