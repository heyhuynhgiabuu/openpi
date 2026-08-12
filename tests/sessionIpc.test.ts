import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { SessionListItem } from '../src/lib/ipc'
import { IPC } from '../src/lib/ipc'

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: vi.fn(),
  },
}))

import { registerSessionsIpc } from '../electron/session/ipc'

type SessionsIpcDeps = Parameters<typeof registerSessionsIpc>[0]
type IpcHandler = (event: unknown, raw?: unknown) => unknown

function createDeps(sessionIndex: {
  refreshSessions: ReturnType<typeof vi.fn>
  listSessions: ReturnType<typeof vi.fn>
  getSessionWorkspace?: ReturnType<typeof vi.fn>
  listWorkspaces?: ReturnType<typeof vi.fn>
  isWorkspaceTrusted?: ReturnType<typeof vi.fn>
}): { deps: SessionsIpcDeps; handlers: Map<string, IpcHandler> } {
  const handlers = new Map<string, IpcHandler>()
  sessionIndex.listWorkspaces ??= vi.fn(() => [])
  sessionIndex.isWorkspaceTrusted ??= vi.fn(() => true)
  const deps = {
    ipcMain: {
      handle: vi.fn((channel: string, handler: IpcHandler) => {
        handlers.set(channel, handler)
      }),
    },
    getMainWindow: vi.fn(() => null),
    getAgentDir: vi.fn(() => '/agent'),
    outputBuffer: [],
    startSession: vi.fn(),
    emitSessionError: vi.fn(),
    ensureActiveSession: vi.fn(),
    getSessionState: vi.fn(() => ({ cwd: '/active', sessionFile: '/sessions/active.jsonl' })),
    getSessionIndex: vi.fn(() => sessionIndex),
    activeWorkspacePath: vi.fn(() => '/active'),
    createRequestId: vi.fn(() => 'request-1'),
    sendSidecar: vi.fn(),
    requestSidecar: vi.fn(),
    buildWorkbenchContextPrefix: vi.fn(() => null),
    confirmHighRiskMutation: vi.fn(),
    refreshSessionIndex: vi.fn(),
    normalizeSessionReady: vi.fn((value) => value),
    applySessionValues: vi.fn(),
    suspendSessionValues: vi.fn(),
    restoreSessionValues: vi.fn(),
  }

  return { deps: deps as unknown as SessionsIpcDeps, handlers }
}

describe('registerSessionsIpc', () => {
  it('rejects opening an indexed path outside the canonical sessions directory', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-session-ipc-'))
    const outsidePath = path.join(tempDir, 'outside.jsonl')
    fs.writeFileSync(outsidePath, '{}\n')
    const sessionIndex = {
      refreshSessions: vi.fn(),
      listSessions: vi.fn(),
      getSessionWorkspace: vi.fn(() => '/work/outside'),
    }
    const { deps, handlers } = createDeps(sessionIndex)
    const agentDir = path.join(tempDir, 'agent')
    fs.mkdirSync(path.join(agentDir, 'sessions'), { recursive: true })
    ;(deps as unknown as { getAgentDir: () => string }).getAgentDir = () => agentDir
    registerSessionsIpc(deps)
    const openSession = handlers.get(IPC.OPEN_SESSION)
    if (!openSession) throw new Error('Expected OPEN_SESSION handler')

    try {
      await expect(openSession({}, { path: outsidePath })).rejects.toThrow(/sessions directory/i)
      expect(deps.startSession).not.toHaveBeenCalled()
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('rejects task artifact reads for a renderer-controlled workspace', async () => {
    const sessionIndex = {
      refreshSessions: vi.fn(),
      listSessions: vi.fn(),
    }
    const { deps, handlers } = createDeps(sessionIndex)
    registerSessionsIpc(deps)
    const readTaskHistory = handlers.get(IPC.READ_TASK_SESSION_HISTORY)
    if (!readTaskHistory) throw new Error('Expected READ_TASK_SESSION_HISTORY handler')

    await expect(readTaskHistory({}, { cwd: '/renderer-controlled' })).rejects.toThrow(
      /unknown workspace/i
    )
  })

  it('suspends main session state before a reload and applies the replacement result', async () => {
    const sessionIndex = {
      refreshSessions: vi.fn(),
      listSessions: vi.fn(),
    }
    const { deps, handlers } = createDeps(sessionIndex)
    const ready = {
      cwd: '/active',
      sessionFile: '/active/session.jsonl',
      sessionId: 'replacement',
      sessionName: null,
      model: null,
      thinkingLevel: 'off',
    }
    vi.mocked(deps.requestSidecar).mockResolvedValue({
      type: 'session_ready',
      requestId: 'request-1',
      payload: ready,
    })
    registerSessionsIpc(deps)
    const reload = handlers.get(IPC.RELOAD_SESSION)
    if (!reload) throw new Error('Expected RELOAD_SESSION handler')

    await reload({})

    expect(deps.suspendSessionValues).toHaveBeenCalledOnce()
    expect(deps.applySessionValues).toHaveBeenCalledWith(ready)
    expect(deps.refreshSessionIndex).toHaveBeenCalledOnce()
  })

  it('restores main session state when a fork replacement fails', async () => {
    const sessionIndex = {
      refreshSessions: vi.fn(),
      listSessions: vi.fn(),
    }
    const { deps, handlers } = createDeps(sessionIndex)
    vi.mocked(deps.requestSidecar).mockRejectedValue(new Error('fork failed'))
    registerSessionsIpc(deps)
    const fork = handlers.get(IPC.FORK_SESSION)
    if (!fork) throw new Error('Expected FORK_SESSION handler')

    await expect(fork({}, { entryId: 'entry-1' })).rejects.toThrow('fork failed')
    expect(deps.suspendSessionValues).toHaveBeenCalledOnce()
    expect(deps.applySessionValues).not.toHaveBeenCalled()
    expect(deps.restoreSessionValues).toHaveBeenCalledWith({
      cwd: '/active',
      sessionFile: '/sessions/active.jsonl',
    })
  })

  it('refreshes a selected workspace before listing sessions', async () => {
    const sessions: SessionListItem[] = []
    const sessionIndex = {
      refreshSessions: vi.fn().mockResolvedValue([]),
      listSessions: vi.fn(() => sessions),
    }
    const { deps, handlers } = createDeps(sessionIndex)
    registerSessionsIpc(deps)

    const getSessions = handlers.get(IPC.GET_SESSIONS)
    expect(getSessions).toBeDefined()
    if (!getSessions) throw new Error('Expected GET_SESSIONS handler')

    const result = await getSessions({}, { workspacePath: '/work/other', showRecent: false })

    expect(result).toBe(sessions)
    expect(sessionIndex.refreshSessions).toHaveBeenCalledWith(
      '/sessions/active.jsonl',
      '/work/other'
    )
    expect(sessionIndex.listSessions).toHaveBeenCalledWith(
      { workspacePath: '/work/other', showRecent: false },
      '/sessions/active.jsonl',
      '/work/other'
    )
  })
})
