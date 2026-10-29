import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A durable start that fails after the session it replaced was disposed. Main restores what it was
 * showing, so a sidecar left empty looks healthy while every prompt goes nowhere; the previous
 * session has to come back.
 */

const durable = vi.hoisted(() => ({
  canResume: vi.fn(async () => true),
  resumeFrom: vi.fn(async () => true),
  start: vi.fn(async () => undefined),
  stop: vi.fn(async () => undefined),
}))

const state = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }))
// The restore re-enters `startSession` without a runtime preference, so it reaches the SDK path;
// the session manager it opens is what proves the previous workspace was reopened.
const opened = vi.hoisted(() => vi.fn(async (cwd: string) => void cwd))

vi.mock('../electron/pi/sidecarContext', () => ({
  clearResourceLoaderCache: vi.fn(),
  getAgentDir: () => '/agent',
  getModelRuntime: vi.fn(async () => ({})),
  getResourceLoader: vi.fn(async () => {
    throw new Error('no resources')
  }),
  getState: () => state.current,
  setState: (value: null | Record<string, unknown>) => {
    state.current = value
  },
  outputLine: vi.fn(),
  send: vi.fn(),
  outputWarn: vi.fn(),
}))
vi.mock('@earendil-works/pi-coding-agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@earendil-works/pi-coding-agent')>()
  return {
    ...actual,
    SessionManager: {
      ...actual.SessionManager,
      open: (path: string, ...rest: unknown[]) => {
        opened(path)
        // SAFETY: the test only needs the call to be recorded before the open fails.
        return (actual.SessionManager.open as (...args: unknown[]) => unknown)(path, ...rest)
      },
    },
  }
})
vi.mock('../electron/pi/durableHost', () => ({
  durableSessions: { ...durable, handleCommand: vi.fn(), isActive: () => false },
}))
vi.mock('../electron/pi/extensionUiPending', () => ({ rejectAllExtensionUiPending: vi.fn() }))
vi.mock('../electron/pi/sessionTeardown', () => ({ teardownSession: vi.fn(async () => undefined) }))
vi.mock('../electron/pi/cutover', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../electron/pi/cutover')>()
  return {
    ...actual,
    decideCutover: (options: Parameters<typeof actual.decideCutover>[0]) =>
      actual.decideCutover({ ...options, capabilities: actual.REQUIRED_CAPABILITIES }),
  }
})

const { startSession } = await import('../electron/pi/sessionLifecycle')

describe('a durable start that fails after the teardown', () => {
  beforeEach(() => {
    for (const mock of Object.values(durable)) mock.mockClear()
    opened.mockClear()
    durable.canResume.mockResolvedValue(true)
    durable.resumeFrom.mockResolvedValue(true)
    durable.start.mockResolvedValue(undefined)
    state.current = null
  })

  it('puts the previous session back and still reports the failure', async () => {
    state.current = {
      cwd: '/previous',
      workspaceTrusted: true,
      unsubscribe: () => undefined,
      session: { sessionFile: '/previous/s.jsonl' },
    }
    durable.start.mockImplementationOnce(async () => {
      throw new Error('the default model is not available')
    })

    // The caller still gets the original failure, whatever the restore manages on its own.
    await expect(
      startSession('/work', { runtimePreference: 'durable', requestId: 'r1' })
    ).rejects.toThrow('the default model is not available')
    // ...and the session it replaced was reopened from its own file.
    expect(opened).toHaveBeenCalledWith('/previous/s.jsonl')
    expect(durable.start).toHaveBeenCalledTimes(1)
  })

  it('does not try to restore anything when there was no previous session', async () => {
    durable.start.mockImplementationOnce(async () => {
      throw new Error('no default model')
    })
    await expect(
      startSession('/work', { runtimePreference: 'durable', requestId: 'r2' })
    ).rejects.toThrow('no default model')
    expect(opened).not.toHaveBeenCalled()
  })
})
