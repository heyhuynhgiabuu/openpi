import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { BrowserWindow, type IpcMain, shell } from 'electron'
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
import { isGitMetadataPath } from './fileGuards'
import { registerDeleteFileIpc } from './fileDelete'
import { checkProtectedPath } from '../services/protectedPaths'
import {
  moveWorkspaceEntryNoReplace,
  readWorkspaceBytes,
  readWorkspaceFile,
  resolveWorkspacePath,
  writeWorkspaceBytes,
  writeWorkspaceFile,
} from '../services/workspacePath'

interface ConfirmMutationOptions {
  title: string
  message: string
  detail: string
}

export interface FileIpcDeps {
  ipcMain: IpcMain
  getCwd: () => string | null
  getMainWindow: () => BrowserWindow | null
  getGitHost: () => Promise<typeof GitHost>
  confirmHighRiskMutation: (options: ConfirmMutationOptions) => Promise<boolean>
}

export function registerFileIpc(deps: FileIpcDeps): void {
  registerDeleteFileIpc(deps)
  deps.ipcMain.handle(IPC.READ_FILE, (_event, raw: unknown): FileContent | null => {
    const parsed = readFileRequestSchema.parse(raw)
    const cwd = deps.getCwd()
    if (!cwd) {
      console.warn(`[openpi:fs] READ_FILE no cwd (path=${parsed.path})`)
      return null
    }
    const { path: relPath } = parsed
    let full: string
    try {
      full = resolveWorkspacePath(cwd, relPath, 'read')
    } catch (err) {
      console.warn(
        `[openpi:fs] READ_FILE outside workspace (cwd=${cwd} path=${relPath}): ${(err as Error).message}`
      )
      return null
    }
    try {
      const rawContent = readWorkspaceFile(full, cwd)
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
    } catch (err) {
      console.warn(
        `[openpi:fs] READ_FILE read error (cwd=${cwd} path=${relPath}): ${(err as Error).message}`
      )
      return null
    }
  })

  deps.ipcMain.handle(IPC.WRITE_FILE, async (_event, raw: unknown): Promise<void> => {
    const parsed = writeFileRequestSchema.parse(raw)
    const cwd = deps.getCwd()
    if (!cwd) {
      console.warn(`[openpi:fs] WRITE_FILE no cwd (path=${parsed.path})`)
      throw new Error('No active workspace')
    }
    const { path: relPath, content } = parsed
    const full = resolveWorkspacePath(cwd, relPath, 'write')
    const initialStat = fs.existsSync(full) ? fs.lstatSync(full) : null
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
    const authorizedFull = resolveWorkspacePath(cwd, relPath, 'write')
    const confirmedViolation = checkProtectedPath(authorizedFull, cwd)
    if (confirmedViolation?.level === 'hard') {
      throw new Error(`Refusing to write protected path: ${confirmedViolation.reason}`)
    }
    if (Boolean(confirmedViolation) !== Boolean(violation)) {
      throw new Error('File protection changed while confirmation was open')
    }
    if (initialStat) {
      const confirmedStat = fs.lstatSync(authorizedFull)
      if (initialStat.dev !== confirmedStat.dev || initialStat.ino !== confirmedStat.ino) {
        throw new Error('File changed while write confirmation was open')
      }
    } else if (fs.existsSync(authorizedFull)) {
      throw new Error('File appeared while write confirmation was open')
    }
    writeWorkspaceFile(authorizedFull, content, cwd)
    deps.getMainWindow()?.webContents.send(IPC.FILE_TREE_CHANGED)
    try {
      const git = await deps.getGitHost()
      deps.getMainWindow()?.webContents.send(IPC.GIT_STATUS_CHANGED, await git.getGitStatus(cwd))
    } catch {}
  })

  deps.ipcMain.handle(IPC.RENAME_FILE, async (_event, raw: unknown): Promise<string> => {
    const parsed = renameFileRequestSchema.parse(raw)
    const cwd = deps.getCwd()
    if (!cwd) {
      console.warn(`[openpi:fs] RENAME_FILE no cwd (path=${parsed.path})`)
      throw new Error('No active workspace')
    }
    const { path: relPath, newName } = parsed
    if (newName.includes('/') || newName.includes('\\') || newName === '.' || newName === '..') {
      throw new Error(`Invalid name: ${newName}`)
    }
    let full = resolveWorkspacePath(cwd, relPath, 'rename')
    let target = resolveWorkspacePath(
      cwd,
      path.relative(cwd, path.join(path.dirname(full), newName)),
      'rename'
    )
    if (fs.existsSync(target)) throw new Error(`Target already exists: ${newName}`)
    if (isGitMetadataPath(relPath) || isGitMetadataPath(path.relative(cwd, target))) {
      throw new Error('Refusing to rename into or out of Git metadata')
    }
    const violation = checkProtectedPath(target, cwd)
    if (violation && violation.level !== 'soft') {
      throw new Error(`Refusing to rename to protected path: ${violation.reason}`)
    }
    // Renaming away from a soft-protected source mutates its identity too.
    const sourceViolation = checkProtectedPath(full, cwd)
    if (sourceViolation && sourceViolation.level !== 'soft') {
      throw new Error(`Refusing to rename protected path: ${sourceViolation.reason}`)
    }
    const sourceStat = fs.lstatSync(full)
    if (violation?.level === 'soft' || sourceViolation?.level === 'soft') {
      const approved = await deps.confirmHighRiskMutation({
        title: 'Confirm protected rename',
        message: `Rename ${path.basename(full)}?`,
        detail: `${(violation ?? sourceViolation)?.reason ?? ''}\n\nFrom: ${full}\nTo: ${target}`,
      })
      if (!approved) return path.relative(cwd, full)
      // Re-resolve and re-verify: protection or the filesystem may have changed
      // during the dialog (same TOCTOU discipline as write/delete).
      full = resolveWorkspacePath(cwd, relPath, 'rename')
      target = resolveWorkspacePath(
        cwd,
        path.relative(cwd, path.join(path.dirname(full), newName)),
        'rename'
      )
      if (fs.existsSync(target)) throw new Error(`Target already exists: ${newName}`)
      const reTarget = checkProtectedPath(target, cwd)
      const reSource = checkProtectedPath(full, cwd)
      if (reTarget?.level === 'hard' || reSource?.level === 'hard') {
        throw new Error('File protection changed while rename confirmation was open')
      }
      const confirmedStat = fs.lstatSync(full)
      if (sourceStat.dev !== confirmedStat.dev || sourceStat.ino !== confirmedStat.ino) {
        throw new Error('File changed while rename confirmation was open')
      }
    }
    moveWorkspaceEntryNoReplace(full, target)
    deps.getMainWindow()?.webContents.send(IPC.FILE_TREE_CHANGED)
    return path.relative(cwd, target)
  })

  deps.ipcMain.handle(IPC.COPY_FILE, async (_event, raw: unknown): Promise<string> => {
    const parsed = copyFileRequestSchema.parse(raw)
    const cwd = deps.getCwd()
    if (!cwd) {
      console.warn(`[openpi:fs] COPY_FILE no cwd (path=${parsed.path})`)
      throw new Error('No active workspace')
    }
    const { path: relPath, target: relTarget } = parsed
    const src = resolveWorkspacePath(cwd, relPath, 'copy')
    let dest: string
    if (relTarget) {
      dest = resolveWorkspacePath(cwd, relTarget, 'copy')
    } else {
      const ext = path.extname(src)
      const base = src.slice(0, src.length - ext.length)
      dest = `${base}-copy${ext}`
      let n = 1
      while (fs.existsSync(dest)) {
        dest = `${base}-copy${n}${ext}`
        n += 1
      }
      dest = resolveWorkspacePath(cwd, path.relative(cwd, dest), 'copy')
    }
    if (fs.existsSync(dest)) {
      throw new Error(`Target already exists: ${path.relative(cwd, dest)}`)
    }
    // Copying TO a protected name creates content under a protected identity.
    const destViolation = checkProtectedPath(dest, cwd)
    if (destViolation?.level === 'hard') {
      throw new Error(`Refusing to copy to protected path: ${destViolation.reason}`)
    }
    if (destViolation) {
      const approved = await deps.confirmHighRiskMutation({
        title: 'Confirm protected copy',
        message: `Copy to ${path.basename(dest)}?`,
        detail: `${destViolation.reason}\n\nPath: ${dest}`,
      })
      if (!approved) return path.relative(cwd, dest)
      const reViolation = checkProtectedPath(
        resolveWorkspacePath(cwd, path.relative(cwd, dest), 'copy'),
        cwd
      )
      if (reViolation?.level === 'hard') {
        throw new Error('File protection changed while copy confirmation was open')
      }
    }
    const stat = fs.statSync(src)
    if (stat.isDirectory()) {
      fs.cpSync(src, dest, {
        recursive: true,
        dereference: false,
        errorOnExist: true,
        force: false,
      })
    } else {
      writeWorkspaceBytes(dest, readWorkspaceBytes(src, cwd), cwd, { exclusive: true })
    }
    deps.getMainWindow()?.webContents.send(IPC.FILE_TREE_CHANGED)
    return path.relative(cwd, dest)
  })

  deps.ipcMain.handle(IPC.FORMAT_FILE, async (_event, raw: unknown): Promise<string> => {
    const parsed = formatFileRequestSchema.parse(raw)
    const cwd = deps.getCwd()
    if (!cwd) {
      console.warn(`[openpi:fs] FORMAT_FILE no cwd (path=${parsed.path})`)
      throw new Error('No active workspace')
    }
    const { path: relPath } = parsed
    const full = resolveWorkspacePath(cwd, relPath, 'format')
    const formatViolation = checkProtectedPath(full, cwd)
    if (formatViolation?.level === 'hard') {
      throw new Error(`Refusing to format protected path: ${formatViolation.reason}`)
    }
    if (formatViolation) {
      const approved = await deps.confirmHighRiskMutation({
        title: 'Confirm protected file format',
        message: `Format ${path.basename(full)}?`,
        detail: `${formatViolation.reason}\n\nPath: ${full}`,
      })
      // Declined: return the source untouched so the editor buffer keeps its
      // content instead of being blanked.
      if (!approved) return readWorkspaceFile(full, cwd)
      const reViolation = checkProtectedPath(resolveWorkspacePath(cwd, relPath, 'format'), cwd)
      if (reViolation?.level === 'hard') {
        throw new Error('File protection changed while format confirmation was open')
      }
    }
    try {
      const source = readWorkspaceFile(full, cwd)
      const formatted = execFileSync('npx', ['oxfmt', '--stdin-filepath', full], {
        cwd,
        timeout: 15_000,
        input: source,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      })
      writeWorkspaceFile(full, formatted, cwd)
      return formatted
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`Format failed: ${msg}`)
    }
  })
}
