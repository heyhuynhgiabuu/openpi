import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerSessionsIpc } from '../electron/session/ipc'
import { IPC } from '../src/lib/ipc'

type IpcHandler = (event: unknown, raw?: unknown) => unknown

interface Fixture {
  handlers: Map<string, IpcHandler>
  getSessionMessages: ReturnType<typeof vi.fn>
  getSessionTree: ReturnType<typeof vi.fn>
  requestSidecar: ReturnType<typeof vi.fn>
}

function createFixture(agentDir: string, sessionFile: string | null = null): Fixture {
  const handlers = new Map<string, IpcHandler>()
  const requestSidecar = vi.fn(async () => ({}))
  const getSessionTree = vi.fn(() => ({
    sessionPath: 'unused',
    branches: [],
    forkPoints: [],
    activeLeafId: null,
  }))
  const getSessionMessages = vi.fn(async () => ({
    messages: [],
    hasMoreBefore: true,
    nextBeforeEntryId: 'from-index',
    limit: 50,
  }))
  const deps = {
    ipcMain: {
      handle: vi.fn((channel: string, handler: IpcHandler) => handlers.set(channel, handler)),
    },
    getMainWindow: () => null,
    getAgentDir: () => agentDir,
    outputBuffer: [],
    startSession: vi.fn(async () => {}),
    emitSessionError: vi.fn(),
    ensureActiveSession: vi.fn(async () => null),
    getSessionState: () => (sessionFile ? { sessionFile } : null),
    getSessionIndex: () => ({ getSessionMessages, getSessionTree }),
    activeWorkspacePath: () => null,
    createRequestId: () => 'req-test',
    sendSidecar: vi.fn(),
    requestSidecar,
    buildWorkbenchContextPrefix: () => null,
    confirmHighRiskMutation: vi.fn(async () => true),
    refreshSessionIndex: vi.fn(async () => {}),
    normalizeSessionReady: (payload: unknown) => payload,
    applySessionValues: vi.fn(),
    suspendSessionValues: vi.fn(),
    restoreSessionValues: vi.fn(),
  } as unknown as Parameters<typeof registerSessionsIpc>[0]
  registerSessionsIpc(deps)
  return { handlers, getSessionMessages, getSessionTree, requestSidecar }
}

describe('session IPC for a session Pi has not flushed yet', () => {
  let tempDir: string
  let sessionDir: string
  let fixture: Fixture

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-session-messages-'))
    sessionDir = path.join(tempDir, 'sessions', '--tmp-workspace--')
    fs.mkdirSync(sessionDir, { recursive: true })
    fixture = createFixture(tempDir)
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('returns an empty history page instead of ENOENT when the file does not exist yet', async () => {
    const handler = fixture.handlers.get(IPC.GET_SESSION_MESSAGES)
    if (!handler) throw new Error('Expected GET_SESSION_MESSAGES handler')
    // Pi flushes the JSONL lazily; a new session's path is authorized but absent.
    const pendingPath = path.join(sessionDir, '2026-09-02T02-23-29-125Z_01a05fed.jsonl')
    expect(fs.existsSync(pendingPath)).toBe(false)

    await expect(handler({}, { path: pendingPath, limit: 50 })).resolves.toEqual({
      messages: [],
      hasMoreBefore: false,
      nextBeforeEntryId: null,
      limit: 50,
    })
    expect(fixture.getSessionMessages).not.toHaveBeenCalled()
  })

  it('still rejects an existing file outside the authorized sessions root', async () => {
    const handler = fixture.handlers.get(IPC.GET_SESSION_MESSAGES)
    if (!handler) throw new Error('Expected GET_SESSION_MESSAGES handler')
    const outsidePath = path.join(tempDir, 'outside.jsonl')
    fs.writeFileSync(outsidePath, '{"type":"session"}\n')

    await expect(handler({}, { path: outsidePath })).rejects.toThrow(
      'Session file is outside an authorized sessions directory'
    )
  })

  it('delegates to the session index when the file exists', async () => {
    const handler = fixture.handlers.get(IPC.GET_SESSION_MESSAGES)
    if (!handler) throw new Error('Expected GET_SESSION_MESSAGES handler')
    const existingPath = path.join(sessionDir, 'existing.jsonl')
    fs.writeFileSync(existingPath, '{"type":"session"}\n')

    await expect(handler({}, { path: existingPath, limit: 50 })).resolves.toMatchObject({
      nextBeforeEntryId: 'from-index',
      hasMoreBefore: true,
    })
    expect(fixture.getSessionMessages).toHaveBeenCalledWith(existingPath, {
      limit: 50,
      beforeEntryId: undefined,
      leafId: undefined,
    })
  })

  it('passes the requested branch leaf through to the history reader', async () => {
    const handler = fixture.handlers.get(IPC.GET_SESSION_MESSAGES)
    if (!handler) throw new Error('Expected GET_SESSION_MESSAGES handler')
    const existingPath = path.join(sessionDir, 'existing.jsonl')
    fs.writeFileSync(existingPath, '{"type":"session"}\n')

    await handler({}, { path: existingPath, limit: 50, leafId: 'entry-42' })

    expect(fixture.getSessionMessages).toHaveBeenCalledWith(existingPath, {
      limit: 50,
      beforeEntryId: undefined,
      leafId: 'entry-42',
    })
  })

  it('marks the switched-to leaf as active when building the tree', async () => {
    const handler = fixture.handlers.get(IPC.GET_SESSION_TREE)
    if (!handler) throw new Error('Expected GET_SESSION_TREE handler')
    const existingPath = path.join(sessionDir, 'existing.jsonl')
    fs.writeFileSync(existingPath, '{"type":"session"}\n')

    await handler({}, { path: existingPath, leafId: 'entry-42' })

    expect(fixture.getSessionTree).toHaveBeenCalledWith(existingPath, 'entry-42')
  })

  it('moves the session leaf through the sidecar and reports the new leaf', async () => {
    const sessionPath = path.join(sessionDir, 'open.jsonl')
    fs.writeFileSync(sessionPath, '{"type":"session"}\n')
    const navigateFixture = createFixture(tempDir, sessionPath)
    navigateFixture.requestSidecar.mockResolvedValueOnce({
      result: { cancelled: false, leafId: 'entry-42' },
    })
    const handler = navigateFixture.handlers.get(IPC.NAVIGATE_SESSION_TREE)
    if (!handler) throw new Error('Expected NAVIGATE_SESSION_TREE handler')

    await expect(
      handler({}, { path: sessionPath, entryId: 'entry-42', summarize: false })
    ).resolves.toEqual({ cancelled: false, leafId: 'entry-42' })

    expect(navigateFixture.requestSidecar).toHaveBeenCalledWith({
      type: 'navigate_tree',
      requestId: 'req-test',
      entryId: 'entry-42',
      summarize: false,
    })
  })

  it('refuses to switch the branch of a session that is not the open one', async () => {
    const sessionPath = path.join(sessionDir, 'open.jsonl')
    const otherPath = path.join(sessionDir, 'other.jsonl')
    fs.writeFileSync(sessionPath, '{"type":"session"}\n')
    fs.writeFileSync(otherPath, '{"type":"session"}\n')
    const navigateFixture = createFixture(tempDir, sessionPath)
    const handler = navigateFixture.handlers.get(IPC.NAVIGATE_SESSION_TREE)
    if (!handler) throw new Error('Expected NAVIGATE_SESSION_TREE handler')

    await expect(handler({}, { path: otherPath, entryId: 'entry-42' })).rejects.toThrow(/not open/)
    expect(navigateFixture.requestSidecar).not.toHaveBeenCalled()
  })

  it('keeps OPEN_SESSION strict: a missing file rejects instead of opening an empty session', async () => {
    const handler = fixture.handlers.get(IPC.OPEN_SESSION)
    if (!handler) throw new Error('Expected OPEN_SESSION handler')
    const pendingPath = path.join(sessionDir, 'pending-open.jsonl')

    await expect(handler({}, { path: pendingPath })).rejects.toThrow(/ENOENT/)
  })
})
