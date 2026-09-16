/**
 * fileDelete.test.ts — the DELETE_FILE handler: mediated-confirm denial and
 * approval, staged trash with rollback, TOCTOU identity re-check, and the
 * Git-metadata/protected-path guards. The confirm is stubbed so both the
 * desktop answer and a mid-confirm mutation can be scripted.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../src/lib/ipc'

vi.mock('../electron/services/protectedPaths', () => ({
  checkProtectedPath: (target: string) =>
    target.includes('protected-hard')
      ? { level: 'hard', rule: 'test-hard', reason: 'hard reason' }
      : null,
}))

const { trashItemMock } = vi.hoisted(() => ({ trashItemMock: vi.fn() }))
vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: vi.fn(() => null) },
  shell: { trashItem: trashItemMock },
}))

import { registerFileIpc } from '../electron/ipc/files'

type IpcHandler = (event: unknown, raw?: unknown) => unknown

const tmpDirs: string[] = []

afterEach(() => {
  trashItemMock.mockReset()
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function createHandlers(
  cwd: string,
  confirm: boolean | (() => Promise<boolean>)
): Map<string, IpcHandler> {
  const handlers = new Map<string, IpcHandler>()
  const deps = {
    ipcMain: {
      handle: vi.fn((channel: string, handler: IpcHandler) => handlers.set(channel, handler)),
    },
    getCwd: () => cwd,
    getMainWindow: () => null,
    getGitHost: vi.fn(() => Promise.reject(new Error('no git in test'))),
    confirmHighRiskMutation: typeof confirm === 'function' ? confirm : async () => confirm,
  }
  registerFileIpc(deps as unknown as Parameters<typeof registerFileIpc>[0])
  return handlers
}

function tmpWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-delete-'))
  tmpDirs.push(dir)
  return dir
}

describe('DELETE_FILE', () => {
  it('answers trashed:false on a denied confirm and touches nothing', async () => {
    const ws = tmpWorkspace()
    const file = path.join(ws, 'a.txt')
    fs.writeFileSync(file, 'x')
    const handlers = createHandlers(ws, false)

    const result = (await handlers.get(IPC.DELETE_FILE)?.({}, { path: 'a.txt' })) as {
      trashed: boolean
    }
    expect(result).toEqual({ trashed: false })
    expect(fs.existsSync(file)).toBe(true)
    expect(trashItemMock).not.toHaveBeenCalled()
  })

  it('stages to trash on approval; a trash failure rolls the file back', async () => {
    const ws = tmpWorkspace()
    const file = path.join(ws, 'a.txt')
    fs.writeFileSync(file, 'x')
    trashItemMock.mockRejectedValueOnce(new Error('trash busy'))
    const handlers = createHandlers(ws, true)

    await expect(handlers.get(IPC.DELETE_FILE)?.({}, { path: 'a.txt' })).rejects.toThrow(
      'trash busy'
    )
    // Rollback: the file is back at its original path.
    expect(fs.readFileSync(file, 'utf8')).toBe('x')
    expect(trashItemMock).toHaveBeenCalledTimes(1)
    const staged = trashItemMock.mock.calls[0]?.[0] as string
    expect(staged).toContain('.openpi-trash-')

    // Second attempt succeeds: original gone, staged path handed to the OS.
    await expect(handlers.get(IPC.DELETE_FILE)?.({}, { path: 'a.txt' })).resolves.toEqual({
      trashed: true,
    })
    expect(fs.existsSync(file)).toBe(false)
    expect(trashItemMock).toHaveBeenCalledTimes(2)
  })

  it('refuses when the file changed while the confirm was open (TOCTOU)', async () => {
    const ws = tmpWorkspace()
    const file = path.join(ws, 'a.txt')
    fs.writeFileSync(file, 'x')
    const handlers = createHandlers(ws, async () => {
      // Swap the file between the pre-confirm lstat and the identity re-check.
      fs.unlinkSync(file)
      fs.writeFileSync(file, 'replaced')
      return true
    })
    await expect(handlers.get(IPC.DELETE_FILE)?.({}, { path: 'a.txt' })).rejects.toThrow(
      'changed while deletion confirmation was open'
    )
    expect(fs.readFileSync(file, 'utf8')).toBe('replaced')
    expect(trashItemMock).not.toHaveBeenCalled()
  })

  it('refuses Git metadata and hard-protected paths before any confirm', async () => {
    const ws = tmpWorkspace()
    fs.mkdirSync(path.join(ws, '.git'))
    fs.writeFileSync(path.join(ws, '.git', 'config'), 'x')
    fs.writeFileSync(path.join(ws, 'protected-hard.txt'), 'x')
    const handlers = createHandlers(ws, true)

    await expect(handlers.get(IPC.DELETE_FILE)?.({}, { path: '.git/config' })).rejects.toThrow(
      'Git metadata'
    )
    await expect(
      handlers.get(IPC.DELETE_FILE)?.({}, { path: 'protected-hard.txt' })
    ).rejects.toThrow('protected path')
    expect(trashItemMock).not.toHaveBeenCalled()
  })
})
