/**
 * fileProtection.test.ts — protected-path guards on the RENAME/COPY/FORMAT
 * mutation handlers: hard violations throw, soft violations require a
 * one-shot confirmation whose denial leaves the filesystem untouched, and the
 * re-check after the confirmation window still refuses hard violations.
 *
 * The real protectedPaths rules are HOME-anchored, so this file mocks the
 * check with substring-driven violations; sibling tests (fileIpc.test.ts,
 * protectedPaths.test.ts) pin the real rules.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../src/lib/ipc'

const { checkProtectedPathMock } = vi.hoisted(() => ({
  checkProtectedPathMock: vi.fn(),
}))

vi.mock('../electron/services/protectedPaths', () => ({
  checkProtectedPath: checkProtectedPathMock,
}))

const { execFileSyncMock } = vi.hoisted(() => ({ execFileSyncMock: vi.fn() }))
vi.mock('node:child_process', () => ({
  default: { execFileSync: execFileSyncMock },
  execFileSync: execFileSyncMock,
  execSync: vi.fn(),
}))

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: vi.fn(() => null) },
  dialog: { showMessageBox: vi.fn() },
  shell: { trashItem: vi.fn() },
}))

import { registerFileIpc } from '../electron/ipc/files'

type IpcHandler = (event: unknown, raw?: unknown) => unknown

const SOFT = { level: 'soft', rule: 'test-soft', reason: 'soft reason' } as const
const HARD = { level: 'hard', rule: 'test-hard', reason: 'hard reason' } as const

/** Violation for paths containing 'protected-soft'/'protected-hard', else null. */
function fakeCheck(targetPath: string): typeof SOFT | typeof HARD | null {
  if (targetPath.includes('protected-hard')) return HARD
  if (targetPath.includes('protected-soft')) return SOFT
  return null
}

const tmpDirs: string[] = []

afterEach(() => {
  checkProtectedPathMock.mockReset()
  execFileSyncMock.mockReset()
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function createHandlers(
  cwd: string,
  approved: boolean | (() => Promise<boolean>)
): Map<string, IpcHandler> {
  const handlers = new Map<string, IpcHandler>()
  const confirm = typeof approved === 'function' ? approved : async () => approved
  const deps = {
    ipcMain: {
      handle: vi.fn((channel: string, handler: IpcHandler) => handlers.set(channel, handler)),
    },
    getCwd: () => cwd,
    getMainWindow: () => null,
    getGitHost: vi.fn(),
    confirmHighRiskMutation: confirm,
  }
  checkProtectedPathMock.mockImplementation(fakeCheck)
  registerFileIpc(deps as unknown as Parameters<typeof registerFileIpc>[0])
  return handlers
}

function tmpWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-protection-'))
  tmpDirs.push(dir)
  return dir
}

describe('file mutation protected-path guards', () => {
  it('RENAME: soft-protected source with approval renames', async () => {
    const ws = tmpWorkspace()
    fs.mkdirSync(path.join(ws, 'protected-soft-dir'))
    fs.writeFileSync(path.join(ws, 'protected-soft-dir', 'a.txt'), 'x')
    const handlers = createHandlers(ws, true)
    await handlers.get(IPC.RENAME_FILE)?.(
      {},
      {
        path: 'protected-soft-dir/a.txt',
        newName: 'b.txt',
      }
    )
    expect(fs.existsSync(path.join(ws, 'protected-soft-dir', 'b.txt'))).toBe(true)
  })

  it('RENAME: declined soft confirmation leaves the file untouched', async () => {
    const ws = tmpWorkspace()
    fs.mkdirSync(path.join(ws, 'protected-soft-dir'))
    fs.writeFileSync(path.join(ws, 'protected-soft-dir', 'a.txt'), 'x')
    const handlers = createHandlers(ws, false)
    const result = await handlers.get(IPC.RENAME_FILE)?.(
      {},
      {
        path: 'protected-soft-dir/a.txt',
        newName: 'b.txt',
      }
    )
    expect(result).toBe(path.join('protected-soft-dir', 'a.txt'))
    expect(fs.existsSync(path.join(ws, 'protected-soft-dir', 'b.txt'))).toBe(false)
  })

  it('RENAME: hard-protected source throws even with approval', async () => {
    const ws = tmpWorkspace()
    fs.mkdirSync(path.join(ws, 'protected-hard-dir'))
    fs.writeFileSync(path.join(ws, 'protected-hard-dir', 'a.txt'), 'x')
    const handlers = createHandlers(ws, true)
    await expect(
      handlers.get(IPC.RENAME_FILE)?.({}, { path: 'protected-hard-dir/a.txt', newName: 'b.txt' })
    ).rejects.toThrow('hard reason')
  })

  it('RENAME: re-verifies source identity after the confirmation dialog', async () => {
    const ws = tmpWorkspace()
    fs.mkdirSync(path.join(ws, 'protected-soft-dir'))
    const source = path.join(ws, 'protected-soft-dir', 'a.txt')
    fs.writeFileSync(source, 'x')
    const handlers = createHandlers(ws, async () => {
      // Swap the file for a fresh inode while the dialog is open: rename the
      // original aside (both inodes coexist) so the new inode is guaranteed to
      // differ — the same TOCTOU window the write/delete guards close.
      fs.renameSync(source, `${source}.swapped-away`)
      fs.writeFileSync(source, 'recreated')
      tmpDirs.push(`${source}.swapped-away`)
      return true
    })
    await expect(
      handlers.get(IPC.RENAME_FILE)?.({}, { path: 'protected-soft-dir/a.txt', newName: 'b.txt' })
    ).rejects.toThrow('File changed while rename confirmation was open')
    expect(fs.existsSync(path.join(ws, 'protected-soft-dir', 'b.txt'))).toBe(false)
  })

  it('COPY: hard-protected destination throws; declined soft leaves no file', async () => {
    const ws = tmpWorkspace()
    fs.writeFileSync(path.join(ws, 'source.txt'), 'data')
    const handlers = createHandlers(ws, false)

    await expect(
      handlers.get(IPC.COPY_FILE)?.({}, { path: 'source.txt', target: 'protected-hard/x.txt' })
    ).rejects.toThrow('hard reason')

    const result = await handlers.get(IPC.COPY_FILE)?.(
      {},
      { path: 'source.txt', target: 'protected-soft/x.txt' }
    )
    expect(result).toBe(path.join('protected-soft', 'x.txt'))
    expect(fs.existsSync(path.join(ws, 'protected-soft', 'x.txt'))).toBe(false)
  })

  it('FORMAT: declined soft confirmation returns the original content without formatting', async () => {
    const ws = tmpWorkspace()
    const source = 'const value=1\n'
    fs.mkdirSync(path.join(ws, 'protected-soft'), { recursive: true })
    fs.writeFileSync(path.join(ws, 'protected-soft', 'a.ts'), source)
    const handlers = createHandlers(ws, false)
    const result = await handlers.get(IPC.FORMAT_FILE)?.({}, { path: 'protected-soft/a.ts' })
    expect(result).toBe(source)
    expect(execFileSyncMock).not.toHaveBeenCalled()
  })

  it('FORMAT: hard-protected file throws even with approval', async () => {
    const ws = tmpWorkspace()
    fs.mkdirSync(path.join(ws, 'protected-hard-dir'), { recursive: true })
    fs.writeFileSync(path.join(ws, 'protected-hard-dir', 'a.ts'), 'const value=1\n')
    const handlers = createHandlers(ws, true)
    await expect(
      handlers.get(IPC.FORMAT_FILE)?.({}, { path: 'protected-hard-dir/a.ts' })
    ).rejects.toThrow('hard reason')
  })
})
