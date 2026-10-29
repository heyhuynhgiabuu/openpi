import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The call site that acts on the cutover choice. The gate is closed in this build, so these tests
 * force it open (see the `cutover` mock) to take the routing as it will run the day it opens: this
 * is the only coverage of that path, and `requestId` is optional, so a dropped argument here is
 * invisible to the type checker and to every durable test.
 */

const durable = vi.hoisted(() => ({
  canResume: vi.fn(async () => true),
  resumeFrom: vi.fn(async () => true),
  start: vi.fn(async () => undefined),
  stop: vi.fn(async () => undefined),
}))

// A stateful stand-in for the sidecar context, so `stopSdkSession` really has a session to dispose
// and the order of the reads against that disposal can be observed. Only the parent port is faked:
// nothing here should reach a real process channel.
const sidecar = vi.hoisted(() => {
  const state: { current: unknown } = { current: null }
  const order: string[] = []
  return {
    order,
    set: (value: unknown) => {
      state.current = value
    },
    get: () => state.current,
    record: (what: string) => void order.push(what),
  }
})

vi.mock('../electron/pi/sidecarContext', () => ({
  clearResourceLoaderCache: vi.fn(),
  getAgentDir: () => '/agent',
  getModelRuntime: vi.fn(async () => ({})),
  getResourceLoader: vi.fn(),
  getState: () => sidecar.get(),
  setState: (value: unknown) => sidecar.set(value),
  outputLine: vi.fn(),
  send: vi.fn(),
  outputWarn: vi.fn(),
}))

// Disposing a real SDK session needs a live agent; the bookkeeping around it is what matters here.
vi.mock('../electron/pi/extensionUiPending', () => ({ rejectAllExtensionUiPending: vi.fn() }))
vi.mock('../electron/pi/sessionTeardown', () => ({ teardownSession: vi.fn(async () => undefined) }))

vi.mock('../electron/pi/durableHost', () => ({
  durableSessions: { ...durable, handleCommand: vi.fn(), isActive: () => false },
}))

vi.mock('../electron/pi/cutover', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../electron/pi/cutover')>()
  // The gate is closed in this build (see `WIRED_DURABLE_CAPABILITIES`), so these tests take the
  // routing the day it opens: every capability present, as the gate would see it then.
  return {
    ...actual,
    decideCutover: (options: Parameters<typeof actual.decideCutover>[0]) =>
      actual.decideCutover({ ...options, capabilities: actual.REQUIRED_CAPABILITIES }),
  }
})

const { startSession } = await import('../electron/pi/sessionLifecycle')

describe('startSession routing', () => {
  beforeEach(() => {
    for (const mock of Object.values(durable)) mock.mockClear()
    durable.canResume.mockResolvedValue(true)
    durable.resumeFrom.mockResolvedValue(true)
  })

  it('starts a new session on the durable runtime', async () => {
    await startSession('/work', {
      runtimePreference: 'durable',
      requestId: 'r1',
      workspaceTrusted: true,
    })
    expect(durable.start).toHaveBeenCalledWith('/work', {
      workspaceTrusted: true,
      requestId: 'r1',
    })
    expect(durable.resumeFrom).not.toHaveBeenCalled()
  })

  it('resumes a file this runtime wrote, with the request id and the trust flag', async () => {
    sidecar.order.length = 0
    sidecar.set({ cwd: '/old', unsubscribe: () => sidecar.record('sdk-unsubscribed'), session: {} })
    durable.canResume.mockImplementation(async () => {
      sidecar.record('canResume')
      return true
    })
    await startSession('/work', {
      runtimePreference: 'durable',
      sessionFile: '/s.jsonl',
      requestId: 'r2',
      workspaceTrusted: true,
    })
    expect(durable.canResume).toHaveBeenCalledWith('/s.jsonl')
    expect(durable.resumeFrom).toHaveBeenCalledWith('/work', '/s.jsonl', true, 'r2')
    expect(durable.start).not.toHaveBeenCalled()
    // The old session was disposed before the new one took over, and not before the read.
    expect(sidecar.order).toEqual(['canResume', 'sdk-unsubscribed'])
  })

  it('reads the file before it disposes the session it is running', async () => {
    sidecar.order.length = 0
    // A live SDK session, so the teardown below is real bookkeeping rather than a no-op.
    sidecar.set({
      cwd: '/work',
      unsubscribe: () => sidecar.record('sdk-unsubscribed'),
      session: {},
    })
    durable.canResume.mockImplementation(async () => {
      sidecar.record('canResume')
      return false
    })
    // The SDK path from here needs a session manager; the order of the reads is what matters.
    await startSession('/work', {
      runtimePreference: 'durable',
      sessionFile: '/s.jsonl',
      requestId: 'r3',
    }).catch(() => undefined)
    // A declined file is never reopened or started over, and the file was read before the teardown.
    expect(durable.resumeFrom).not.toHaveBeenCalled()
    expect(durable.start).not.toHaveBeenCalled()
    // `stopSdkSession` unsubscribes the running session; that step must come after the read.
    expect(sidecar.order.slice(0, 2)).toEqual(['canResume', 'sdk-unsubscribed'])
  })

  it('answers the open request when the file changes between the check and the resume', async () => {
    // `canResume` yes, `resumeFrom` no: another writer touched the file in between. The session is
    // already disposed by then, so the only correct answer is an error naming the request.
    durable.resumeFrom.mockResolvedValueOnce(false)
    await expect(
      startSession('/work', {
        runtimePreference: 'durable',
        sessionFile: '/s.jsonl',
        requestId: 'r5',
      })
    ).rejects.toThrow(/changed while it was being opened/)
  })

  it('keeps a fork on the SDK path even under an opt-in', async () => {
    await startSession('/work', {
      runtimePreference: 'durable',
      sessionFile: '/s.jsonl',
      forkEntryId: 'abc',
      requestId: 'r4',
    }).catch(() => undefined)
    expect(durable.canResume).not.toHaveBeenCalled()
    expect(durable.resumeFrom).not.toHaveBeenCalled()
  })
})
