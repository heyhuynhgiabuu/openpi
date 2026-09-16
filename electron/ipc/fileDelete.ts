/**
 * fileDelete — the DELETE_FILE handler: mediated confirm (with the remote
 * registry hop), identity re-check, staged trash with rollback.
 * Split from files.ts for the 300-LOC rule.
 */
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { shell, type IpcMain } from 'electron'
import { deleteFileRequestSchema, deleteFileResultSchema, IPC } from '../../src/lib/ipc'
import type * as GitHost from '../git/gitHost'
import { checkProtectedPath } from '../services/protectedPaths'
import { moveWorkspaceEntryNoReplace, resolveWorkspacePath } from '../services/workspacePath'
import { isGitMetadataPath } from './fileGuards'
import type { FileIpcDeps } from './files'

export function registerDeleteFileIpc(deps: FileIpcDeps): void {
  deps.ipcMain.handle(IPC.DELETE_FILE, async (_event, raw: unknown): Promise<unknown> => {
    const parsed = deleteFileRequestSchema.parse(raw)
    const cwd = deps.getCwd()
    if (!cwd) {
      console.warn(`[openpi:fs] DELETE_FILE no cwd (path=${parsed.path})`)
      throw new Error('No active workspace')
    }
    const { path: relPath } = parsed
    const full = resolveWorkspacePath(cwd, relPath, 'delete')

    if (isGitMetadataPath(relPath)) {
      throw new Error('Refusing to delete Git metadata')
    }

    const violation = checkProtectedPath(full, cwd)
    if (violation && violation.level !== 'soft') {
      throw new Error(`Refusing to delete protected path: ${violation.reason}`)
    }

    const stat = fs.lstatSync(full)
    // Routed through the mediated confirm so the remote registry hop covers
    // deletions too (paired devices can deny a pending trash).
    const trashed = await deps.confirmHighRiskMutation({
      title: `Delete ${stat.isDirectory() ? 'folder' : 'file'}?`,
      message: `Move ${path.basename(full)} to Trash?`,
      detail: relPath,
    })
    if (!trashed) return deleteFileResultSchema.parse({ trashed: false })

    const authorizedFull = resolveWorkspacePath(cwd, relPath, 'delete')
    const confirmedStat = fs.lstatSync(authorizedFull)
    if (stat.dev !== confirmedStat.dev || stat.ino !== confirmedStat.ino) {
      throw new Error('File changed while deletion confirmation was open')
    }
    const stagedTrashPath = resolveWorkspacePath(
      cwd,
      path.relative(cwd, path.join(path.dirname(authorizedFull), `.openpi-trash-${randomUUID()}`)),
      'delete'
    )
    moveWorkspaceEntryNoReplace(authorizedFull, stagedTrashPath)
    try {
      await shell.trashItem(stagedTrashPath)
    } catch (error) {
      moveWorkspaceEntryNoReplace(stagedTrashPath, authorizedFull)
      throw error
    }
    deps.getMainWindow()?.webContents.send(IPC.FILE_TREE_CHANGED)
    try {
      const git = await deps.getGitHost()
      deps.getMainWindow()?.webContents.send(IPC.GIT_STATUS_CHANGED, await git.getGitStatus(cwd))
    } catch {
      // Git status refresh is best-effort; the file-tree refresh above is authoritative here.
    }
    return deleteFileResultSchema.parse({ trashed: true })
  })
}
