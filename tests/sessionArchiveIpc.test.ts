import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { shell } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerSessionArchiveIpc } from '../electron/session/archiveIpc'
import { IPC } from '../src/lib/ipc'

vi.mock('electron', () => ({
  shell: { trashItem: vi.fn() },
}))

type IpcHandler = (event: unknown, raw?: unknown) => unknown

interface Fixture {
  agentDir: string
  handlers: Map<string, IpcHandler>
}

function createFixture(agentDir: string): Fixture {
  const handlers = new Map<string, IpcHandler>()
  const deps: Parameters<typeof registerSessionArchiveIpc>[0] = {
    ipcMain: {
      handle: vi.fn((channel: string, handler: IpcHandler) => handlers.set(channel, handler)),
    } as unknown as Parameters<typeof registerSessionArchiveIpc>[0]['ipcMain'],
    getAgentDir: () => agentDir,
    getActiveSessionFile: () => null,
    getActiveCwd: () => null,
    startSession: vi.fn(),
    refreshSessionIndex: vi.fn(),
    emitOutputLine: vi.fn(),
  }
  registerSessionArchiveIpc(deps)
  return { agentDir, handlers }
}

describe('session archive path authorization', () => {
  let tempDir: string
  let agentDir: string
  let sessionDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-session-archive-'))
    agentDir = path.join(tempDir, 'agent')
    sessionDir = path.join(agentDir, 'sessions', 'workspace')
    fs.mkdirSync(sessionDir, { recursive: true })
  })

  afterEach(() => {
    vi.mocked(shell.trashItem).mockReset()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('archives a regular session file inside the canonical sessions directory', async () => {
    const filePath = path.join(sessionDir, 'valid.jsonl')
    fs.writeFileSync(filePath, '{}\n')
    const { handlers } = createFixture(agentDir)
    const archive = handlers.get(IPC.ARCHIVE_SESSIONS)
    if (!archive) throw new Error('Expected ARCHIVE_SESSIONS handler')

    await expect(archive({}, { paths: [filePath] })).resolves.toEqual({ archived: 1, skipped: 0 })
    expect(fs.existsSync(`${filePath}.archived`)).toBe(true)
  })

  it('does not overwrite an existing archived session', async () => {
    const filePath = path.join(sessionDir, 'duplicate.jsonl')
    const archivedPath = `${filePath}.archived`
    fs.writeFileSync(filePath, 'current\n')
    fs.writeFileSync(archivedPath, 'existing archive\n')
    const { handlers } = createFixture(agentDir)
    const archive = handlers.get(IPC.ARCHIVE_SESSIONS)
    if (!archive) throw new Error('Expected ARCHIVE_SESSIONS handler')

    await expect(archive({}, { paths: [filePath] })).resolves.toEqual({ archived: 0, skipped: 1 })
    expect(fs.readFileSync(archivedPath, 'utf-8')).toBe('existing archive\n')
    expect(fs.existsSync(filePath)).toBe(true)
  })

  it('rejects a session path outside the canonical sessions directory', async () => {
    const outsidePath = path.join(tempDir, 'outside.jsonl')
    fs.writeFileSync(outsidePath, '{}\n')
    const { handlers } = createFixture(agentDir)
    const archive = handlers.get(IPC.ARCHIVE_SESSIONS)
    if (!archive) throw new Error('Expected ARCHIVE_SESSIONS handler')

    await expect(archive({}, { paths: [outsidePath] })).resolves.toEqual({
      archived: 0,
      skipped: 1,
    })
    expect(fs.existsSync(outsidePath)).toBe(true)
    expect(fs.existsSync(`${outsidePath}.archived`)).toBe(false)
  })

  it('rejects a symlinked session file', async () => {
    const outsidePath = path.join(tempDir, 'outside.jsonl')
    const linkPath = path.join(sessionDir, 'linked.jsonl')
    fs.writeFileSync(outsidePath, '{}\n')
    fs.symlinkSync(outsidePath, linkPath)
    const { handlers } = createFixture(agentDir)
    const archive = handlers.get(IPC.ARCHIVE_SESSIONS)
    if (!archive) throw new Error('Expected ARCHIVE_SESSIONS handler')

    await expect(archive({}, { paths: [linkPath] })).resolves.toEqual({ archived: 0, skipped: 1 })
    expect(fs.lstatSync(linkPath).isSymbolicLink()).toBe(true)
  })

  it('does not list archived sessions through a symlinked directory', () => {
    const outsideDir = path.join(tempDir, 'outside-sessions')
    fs.mkdirSync(outsideDir)
    fs.writeFileSync(path.join(outsideDir, 'leaked.jsonl.archived'), '{}\n')
    fs.symlinkSync(outsideDir, path.join(agentDir, 'sessions', 'linked-workspace'))
    const { handlers } = createFixture(agentDir)
    const listArchived = handlers.get(IPC.LIST_ARCHIVED_SESSIONS)
    if (!listArchived) throw new Error('Expected LIST_ARCHIVED_SESSIONS handler')

    expect(listArchived({})).toEqual([])
  })

  it('does not overwrite an existing live session when unarchiving', async () => {
    const livePath = path.join(sessionDir, 'duplicate.jsonl')
    const archivedPath = `${livePath}.archived`
    fs.writeFileSync(livePath, 'current\n')
    fs.writeFileSync(archivedPath, 'archive\n')
    const { handlers } = createFixture(agentDir)
    const unarchive = handlers.get(IPC.UNARCHIVE_SESSIONS)
    if (!unarchive) throw new Error('Expected UNARCHIVE_SESSIONS handler')

    await unarchive({}, { paths: [archivedPath] })

    expect(fs.readFileSync(livePath, 'utf-8')).toBe('current\n')
    expect(fs.existsSync(archivedPath)).toBe(true)
  })

  it('does not delete a symlinked session file', async () => {
    const outsidePath = path.join(tempDir, 'outside.jsonl.archived')
    const linkPath = path.join(sessionDir, 'linked.jsonl.archived')
    fs.writeFileSync(outsidePath, '{}\n')
    fs.symlinkSync(outsidePath, linkPath)
    const { handlers } = createFixture(agentDir)
    const deleteSession = handlers.get(IPC.DELETE_SESSION)
    if (!deleteSession) throw new Error('Expected DELETE_SESSION handler')

    await expect(deleteSession({}, { path: linkPath })).resolves.toEqual({ deleted: 0, failed: 1 })
    expect(shell.trashItem).not.toHaveBeenCalled()
  })

  it('does not delete a session through a symlinked parent directory', async () => {
    const outsideDir = path.join(tempDir, 'outside-sessions')
    const outsidePath = path.join(outsideDir, 'outside.jsonl.archived')
    fs.mkdirSync(outsideDir)
    fs.writeFileSync(outsidePath, '{}\n')
    const linkedDir = path.join(agentDir, 'sessions', 'linked-workspace')
    fs.symlinkSync(outsideDir, linkedDir)
    const { handlers } = createFixture(agentDir)
    const deleteSession = handlers.get(IPC.DELETE_SESSION)
    if (!deleteSession) throw new Error('Expected DELETE_SESSION handler')

    await expect(
      deleteSession({}, { path: path.join(linkedDir, 'outside.jsonl.archived') })
    ).resolves.toEqual({
      deleted: 0,
      failed: 1,
    })
    expect(shell.trashItem).not.toHaveBeenCalled()
  })

  it('does not overwrite an archived session while deleting a live session', async () => {
    const livePath = path.join(sessionDir, 'duplicate.jsonl')
    const archivedPath = `${livePath}.archived`
    fs.writeFileSync(livePath, 'current\n')
    fs.writeFileSync(archivedPath, 'existing archive\n')
    const { handlers } = createFixture(agentDir)
    const deleteSession = handlers.get(IPC.DELETE_SESSION)
    if (!deleteSession) throw new Error('Expected DELETE_SESSION handler')

    await expect(deleteSession({}, { path: livePath })).resolves.toEqual({ deleted: 0, failed: 1 })
    expect(fs.readFileSync(livePath, 'utf-8')).toBe('current\n')
    expect(fs.readFileSync(archivedPath, 'utf-8')).toBe('existing archive\n')
    expect(shell.trashItem).not.toHaveBeenCalled()
  })

  it('rejects unarchiving a path outside the canonical sessions directory', async () => {
    const outsidePath = path.join(tempDir, 'outside.jsonl.archived')
    fs.writeFileSync(outsidePath, '{}\n')
    const { handlers } = createFixture(agentDir)
    const unarchive = handlers.get(IPC.UNARCHIVE_SESSIONS)
    if (!unarchive) throw new Error('Expected UNARCHIVE_SESSIONS handler')

    await unarchive({}, { paths: [outsidePath] })

    expect(fs.existsSync(outsidePath)).toBe(true)
    expect(fs.existsSync(outsidePath.slice(0, -'.archived'.length))).toBe(false)
  })
})
