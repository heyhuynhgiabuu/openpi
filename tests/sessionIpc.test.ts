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
}): { deps: SessionsIpcDeps; handlers: Map<string, IpcHandler> } {
  const handlers = new Map<string, IpcHandler>()
  const deps = {
    ipcMain: {
      handle: vi.fn((channel: string, handler: IpcHandler) => {
        handlers.set(channel, handler)
      }),
    },
    getMainWindow: vi.fn(() => null),
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
    normalizeSessionReady: vi.fn(),
    applySessionValues: vi.fn(),
  }

  return { deps: deps as unknown as SessionsIpcDeps, handlers }
}

describe('registerSessionsIpc', () => {
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
