import { execSync } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { BrowserWindow, dialog, type IpcMain, shell } from 'electron'
import type { FileContent } from '../../src/lib/ipc'
import {
  copyFileRequestSchema,
  deleteFileRequestSchema,
  deleteFileResultSchema,
  formatFileRequestSchema,
  IPC,
  readFileRequestSchema,
  renameFileRequestSchema,
  writeFileRequestSchema,
} from '../../src/lib/ipc'
import type * as GitHost from '../git/gitHost'
import { checkProtectedPath } from '../services/protectedPaths'

interface ConfirmMutationOptions {
  title: string
  message: string
  detail: string
}

interface FileIpcDeps {
  ipcMain: IpcMain
  getCwd: () => string | null
  getMainWindow: () => BrowserWindow | null
  getGitHost: () => Promise<typeof GitHost>
  confirmHighRiskMutation: (options: ConfirmMutationOptions) => Promise<boolean>
}

function resolveWorkspaceRelativePath(cwd: string, relPath: string, action: string): string {
  const full = path.resolve(cwd, relPath)
  const sep = path.sep
  if (full === cwd || !full.startsWith(cwd + sep)) {
    throw new Error(`Refusing to ${action} outside workspace`)
  }
  return full
}

function isGitMetadataPath(relPath: string): boolean {
  const parts = relPath.split(/[\\/]+/).filter(Boolean)
  return parts.includes('.git')
}

export function registerFileIpc(deps: FileIpcDeps): void {
  deps.ipcMain.handle(IPC.READ_FILE, (_event, raw: unknown): FileContent | null => {
    const cwd = deps.getCwd()
    if (!cwd) return null
    const { path: relPath } = readFileRequestSchema.parse(raw)
    let full: string
    try {
      full = resolveWorkspaceRelativePath(cwd, relPath, 'read')
    } catch {
      return null
    }
    try {
      const rawContent = fs.readFileSync(full, 'utf-8')
      const size = Buffer.byteLength(rawContent, 'utf-8')
      const limit = 500_000
      if (size > limit) {
        return {
          content: `${rawContent.slice(0, limit)}\n… [file truncated]`,
          size,
          truncated: true,
        }
      }
      return { content: rawContent, size, truncated: false }
    } catch {
      return null
    }
  })

  deps.ipcMain.handle(IPC.WRITE_FILE, async (_event, raw: unknown): Promise<void> => {
    const cwd = deps.getCwd()
    if (!cwd) throw new Error('No active workspace')
    const { path: relPath, content } = writeFileRequestSchema.parse(raw)
    const full = resolveWorkspaceRelativePath(cwd, relPath, 'write')
    const violation = checkProtectedPath(full, cwd)
    if (violation?.level === 'hard') {
      throw new Error(`Refusing to write protected path: ${violation.reason}`)
    }
    if (violation) {
      const approved = await deps.confirmHighRiskMutation({
        title: 'Confirm protected file write',
        message: `Write to ${path.basename(full)}?`,
        detail: `${violation.reason}\n\nPath: ${full}`,
      })
      if (!approved) return
    }
    fs.writeFileSync(full, content, 'utf-8')
  })

  deps.ipcMain.handle(IPC.DELETE_FILE, async (event, raw: unknown): Promise<unknown> => {
    const cwd = deps.getCwd()
    if (!cwd) throw new Error('No active workspace')
    const { path: relPath } = deleteFileRequestSchema.parse(raw)
    const full = resolveWorkspaceRelativePath(cwd, relPath, 'delete')

    if (isGitMetadataPath(relPath)) {
      throw new Error('Refusing to delete Git metadata')
    }

    const violation = checkProtectedPath(full, cwd)
    if (violation && violation.level !== 'soft') {
      throw new Error(`Refusing to delete protected path: ${violation.reason}`)
    }

    const stat = fs.statSync(full)
    const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? deps.getMainWindow()
    const confirmOptions = {
      type: 'warning' as const,
      buttons: ['Move to Trash', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: `Delete ${stat.isDirectory() ? 'folder' : 'file'}?`,
      message: `Move ${path.basename(full)} to Trash?`,
      detail: relPath,
    }
    const { response } = parentWindow
      ? await dialog.showMessageBox(parentWindow, confirmOptions)
      : await dialog.showMessageBox(confirmOptions)
    if (response !== 0) return deleteFileResultSchema.parse({ trashed: false })

    await shell.trashItem(full)
    deps.getMainWindow()?.webContents.send(IPC.FILE_TREE_CHANGED)
    try {
      const git = await deps.getGitHost()
      deps.getMainWindow()?.webContents.send(IPC.GIT_STATUS_CHANGED, await git.getGitStatus(cwd))
    } catch {
      // Git status refresh is best-effort; the file-tree refresh above is authoritative here.
    }
    return deleteFileResultSchema.parse({ trashed: true })
  })

  deps.ipcMain.handle(IPC.RENAME_FILE, async (_event, raw: unknown): Promise<string> => {
    const cwd = deps.getCwd()
    if (!cwd) throw new Error('No active workspace')
    const { path: relPath, newName } = renameFileRequestSchema.parse(raw)
    if (newName.includes('/') || newName.includes('\\') || newName === '.' || newName === '..') {
      throw new Error(`Invalid name: ${newName}`)
    }
    const full = resolveWorkspaceRelativePath(cwd, relPath, 'rename')
    const target = path.join(path.dirname(full), newName)
    if (fs.existsSync(target)) {
      throw new Error(`Target already exists: ${newName}`)
    }
    if (isGitMetadataPath(relPath) || isGitMetadataPath(path.relative(cwd, target))) {
      throw new Error('Refusing to rename into or out of Git metadata')
    }
    const violation = checkProtectedPath(target, cwd)
    if (violation && violation.level !== 'soft') {
      throw new Error(`Refusing to rename to protected path: ${violation.reason}`)
    }
    fs.renameSync(full, target)
    deps.getMainWindow()?.webContents.send(IPC.FILE_TREE_CHANGED)
    return path.relative(cwd, target)
  })

  deps.ipcMain.handle(IPC.COPY_FILE, async (_event, raw: unknown): Promise<string> => {
    const cwd = deps.getCwd()
    if (!cwd) throw new Error('No active workspace')
    const { path: relPath, target: relTarget } = copyFileRequestSchema.parse(raw)
    const src = resolveWorkspaceRelativePath(cwd, relPath, 'copy')
    let dest: string
    if (relTarget) {
      dest = resolveWorkspaceRelativePath(cwd, relTarget, 'copy')
    } else {
      const ext = path.extname(src)
      const base = src.slice(0, src.length - ext.length)
      dest = `${base}-copy${ext}`
      let n = 1
      while (fs.existsSync(dest)) {
        dest = `${base}-copy${n}${ext}`
        n += 1
      }
    }
    if (fs.existsSync(dest)) {
      throw new Error(`Target already exists: ${path.relative(cwd, dest)}`)
    }
    const stat = fs.statSync(src)
    if (stat.isDirectory()) {
      fs.cpSync(src, dest, { recursive: true })
    } else {
      fs.copyFileSync(src, dest)
    }
    deps.getMainWindow()?.webContents.send(IPC.FILE_TREE_CHANGED)
    return path.relative(cwd, dest)
  })

  deps.ipcMain.handle(IPC.FORMAT_FILE, async (_event, raw: unknown): Promise<string> => {
    const cwd = deps.getCwd()
    if (!cwd) throw new Error('No active workspace')
    const { path: relPath } = formatFileRequestSchema.parse(raw)
    const full = path.resolve(cwd, relPath)
    const sep = path.sep
    if (full !== cwd && !full.startsWith(cwd + sep)) {
      throw new Error('Refusing to format outside workspace')
    }
    try {
      execSync(`npx biome format --write "${full}"`, {
        cwd,
        timeout: 15_000,
        stdio: 'pipe',
      })
      return fs.readFileSync(full, 'utf-8')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`Format failed: ${msg}`)
    }
  })
}
