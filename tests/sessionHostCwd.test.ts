import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }))

vi.mock('electron', () => ({}))
vi.mock('../electron/pi/sidecarHost', () => ({
  PiSidecarHost: class {
    request = requestMock
    start(): void {}
  },
}))
vi.mock('../electron/services/notificationHost', () => ({ emitSessionError: vi.fn() }))
vi.mock('../electron/git/worktree', () => ({ removeWorktree: vi.fn() }))

import {
  applySessionValues,
  clearSessionState,
  setSessionHostSessionIndex,
  startSession,
} from '../electron/session/sessionHost'
import { threadCwdRegistry } from '../electron/session/threadCwd'

describe('session host cwd lifecycle', () => {
  beforeEach(() => {
    requestMock.mockReset()
    clearSessionState()
    threadCwdRegistry.clearActive()
    setSessionHostSessionIndex(null)
  })

  it('clears the privileged active cwd while a replacement is pending', async () => {
    applySessionValues({
      cwd: '/old-workspace',
      sessionFile: '/old-workspace/session.jsonl',
      sessionId: 'old-session',
      sessionName: null,
      model: null,
      thinkingLevel: 'off',
    })
    let resolveRequest: ((value: unknown) => void) | undefined
    requestMock.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve
      })
    )

    const replacement = startSession('/new-workspace')
    expect(threadCwdRegistry.resolveSafe()).toBeNull()

    if (!resolveRequest) throw new Error('Expected pending sidecar request')
    resolveRequest({
      type: 'session_ready',
      requestId: 'request-1',
      payload: {
        cwd: '/new-workspace',
        sessionFile: '/new-workspace/session.jsonl',
        sessionId: 'new-session',
        sessionName: null,
        model: null,
        thinkingLevel: 'off',
      },
    })
    await replacement
    expect(threadCwdRegistry.resolveSafe()).toBe('/new-workspace')
  })
})
