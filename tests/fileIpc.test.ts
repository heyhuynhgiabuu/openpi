import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../src/lib/ipc'

const { execFileSyncMock, execSyncMock } = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(),
  execSyncMock: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  default: { execFileSync: execFileSyncMock, execSync: execSyncMock },
  execFileSync: execFileSyncMock,
  execSync: execSyncMock,
}))

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: vi.fn(() => null) },
  dialog: { showMessageBox: vi.fn() },
  shell: { trashItem: vi.fn() },
}))

import { registerFileIpc } from '../electron/ipc/files'

type IpcHandler = (event: unknown, raw?: unknown) => unknown

function createHandlers(cwd: string): Map<string, IpcHandler> {
  const handlers = new Map<string, IpcHandler>()
  const deps: Parameters<typeof registerFileIpc>[0] = {
    ipcMain: {
      handle: vi.fn((channel: string, handler: IpcHandler) => handlers.set(channel, handler)),
    } as unknown as Parameters<typeof registerFileIpc>[0]['ipcMain'],
    getCwd: () => cwd,
    getMainWindow: () => null,
    getGitHost: vi.fn(),
    confirmHighRiskMutation: vi.fn(),
  }
  registerFileIpc(deps)
  return handlers
}

describe('file IPC command safety', () => {
  let tempDir: string | undefined

  afterEach(() => {
    execFileSyncMock.mockReset()
    execSyncMock.mockReset()
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true })
    tempDir = undefined
  })

  it('passes a hostile filename as one formatter argument without a shell', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-format-'))
    const relativePath = 'name & echo compromised.ts'
    const fullPath = path.join(tempDir, relativePath)
    fs.writeFileSync(fullPath, 'const value=1\n', 'utf-8')
    execFileSyncMock.mockReturnValue('const value = 1\n')
    const handler = createHandlers(tempDir).get(IPC.FORMAT_FILE)
    if (!handler) throw new Error('Expected FORMAT_FILE handler')

    await handler({}, { path: relativePath })

    expect(execFileSyncMock).toHaveBeenCalledWith(
      'npx',
      ['biome', 'format', '--stdin-file-path', fullPath],
      expect.objectContaining({
        cwd: tempDir,
        input: 'const value=1\n',
        encoding: 'utf-8',
        shell: false,
      })
    )
    expect(execSyncMock).not.toHaveBeenCalled()
  })

  it('copies regular files without UTF-8 decoding binary content', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-copy-'))
    const source = Buffer.from([0, 255, 128, 1, 2, 3])
    fs.writeFileSync(path.join(tempDir, 'binary.dat'), source)
    const handler = createHandlers(tempDir).get(IPC.COPY_FILE)
    if (!handler) throw new Error('Expected COPY_FILE handler')

    await handler({}, { path: 'binary.dat' })

    expect(fs.readFileSync(path.join(tempDir, 'binary-copy.dat'))).toEqual(source)
  })

  it('does not read through a symlink that resolves outside the workspace', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-read-'))
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-outside-'))
    const outsideFile = path.join(outsideDir, 'secret.txt')
    fs.writeFileSync(outsideFile, 'secret', 'utf-8')
    fs.symlinkSync(outsideFile, path.join(tempDir, 'linked.txt'))
    const handler = createHandlers(tempDir).get(IPC.READ_FILE)
    if (!handler) throw new Error('Expected READ_FILE handler')

    try {
      expect(handler({}, { path: 'linked.txt' })).toBeNull()
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true })
    }
  })

  it('does not create a file through a symlinked directory outside the workspace', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-write-'))
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-outside-'))
    fs.symlinkSync(outsideDir, path.join(tempDir, 'linked-dir'))
    const handler = createHandlers(tempDir).get(IPC.WRITE_FILE)
    if (!handler) throw new Error('Expected WRITE_FILE handler')

    try {
      await expect(
        handler({}, { path: 'linked-dir/escaped.txt', content: 'escaped' })
      ).rejects.toThrow(/outside workspace|symlink/i)
      expect(fs.existsSync(path.join(outsideDir, 'escaped.txt'))).toBe(false)
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true })
    }
  })

  it('does not write through a dangling symlink inside the workspace', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-write-'))
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-outside-'))
    const outsidePath = path.join(outsideDir, 'created.txt')
    fs.symlinkSync(outsidePath, path.join(tempDir, 'dangling.txt'))
    const handler = createHandlers(tempDir).get(IPC.WRITE_FILE)
    if (!handler) throw new Error('Expected WRITE_FILE handler')

    try {
      await expect(handler({}, { path: 'dangling.txt', content: 'escaped' })).rejects.toThrow(
        /symlink/i
      )
      expect(fs.existsSync(outsidePath)).toBe(false)
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true })
    }
  })
})
