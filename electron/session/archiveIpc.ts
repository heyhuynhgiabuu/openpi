import fs from 'node:fs'
import path from 'node:path'
import { type IpcMain, shell } from 'electron'
import type { ArchivedSessionItem, ArchiveSessionsResult, OutputLine } from '../../src/lib/ipc'
import {
  archiveSessionsRequestSchema,
  deleteSessionsRequestSchema,
  IPC,
  unarchiveSessionsRequestSchema,
} from '../../src/lib/ipc'
import { isPathInside } from '../services/shellEnv'

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

      for (const filePath of paths) {
        if (!filePath.endsWith('.jsonl')) {
          skipped++
          continue
        }
        try {
          fs.renameSync(filePath, `${filePath}.archived`)
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
        stat = fs.statSync(dirPath)
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
        const archivedPath = path.join(dirPath, file)
        const originalPath = archivedPath.slice(0, -'.archived'.length)
        let mtime = 0
        try {
          mtime = fs.statSync(archivedPath).mtimeMs
        } catch {
          /* ignore */
        }
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
    for (const archivedPath of paths) {
      if (!archivedPath.endsWith('.jsonl.archived')) continue
      const originalPath = archivedPath.slice(0, -'.archived'.length)
      try {
        fs.renameSync(archivedPath, originalPath)
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
      const sessionsDir = path.resolve(deps.getAgentDir(), 'sessions')
      const realSessionsDir = fs.existsSync(sessionsDir)
        ? fs.realpathSync(sessionsDir)
        : sessionsDir
      let deleted = 0
      let failed = 0

      for (const submittedPath of paths) {
        const filePath = path.resolve(submittedPath)
        try {
          if (!filePath.endsWith('.jsonl.archived') || !isPathInside(sessionsDir, filePath)) {
            failed++
            continue
          }

          const stat = fs.lstatSync(filePath)
          if (!stat.isFile()) {
            failed++
            continue
          }

          const realFilePath = fs.realpathSync(filePath)
          if (!isPathInside(realSessionsDir, realFilePath)) {
            failed++
            continue
          }

          await shell.trashItem(filePath)
          deleted++
        } catch (err) {
          console.warn(`[delete-sessions] failed to trash ${filePath}: ${String(err)}`)
          failed++
        }
      }
      await deps.refreshSessionIndex()
      return { deleted, failed }
    }
  )
}
