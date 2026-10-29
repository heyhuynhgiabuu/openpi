import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Phase 8.5: the call site that acts on the cutover choice. It is only reachable now that the gate
 * reports the command set as wired, and nothing else tests it: `requestId` is optional, so a
 * dropped argument here is invisible to the type checker and to every durable test.
 */

const durable = vi.hoisted(() => ({
  canResume: vi.fn(async () => true),
  resumeFrom: vi.fn(async () => true),
  start: vi.fn(async () => undefined),
  stop: vi.fn(async () => undefined),
}))

// The sidecar's parent port: nothing here should reach a real process channel.
vi.mock('../electron/pi/sidecarContext', () => ({
  clearResourceLoaderCache: vi.fn(),
  getAgentDir: () => '/agent',
  getModelRuntime: vi.fn(async () => ({})),
  getResourceLoader: vi.fn(),
  getState: () => null,
  outputLine: vi.fn(),
  send: vi.fn(),
  setState: vi.fn(),
  outputWarn: vi.fn(),
}))

vi.mock('../electron/pi/durableHost', () => ({
  durableSessions: { ...durable, handleCommand: vi.fn(), isActive: () => false },
}))

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
    await startSession('/work', {
      runtimePreference: 'durable',
      sessionFile: '/s.jsonl',
      requestId: 'r2',
      workspaceTrusted: true,
    })
    expect(durable.canResume).toHaveBeenCalledWith('/s.jsonl')
    expect(durable.resumeFrom).toHaveBeenCalledWith('/work', '/s.jsonl', true, 'r2')
    expect(durable.start).not.toHaveBeenCalled()
  })

  it('reads the file before it disposes the session it is running', async () => {
    const order: string[] = []
    durable.canResume.mockImplementation(async () => {
      order.push('canResume')
      return false
    })
    // The SDK path from here needs a session manager; what matters is the order of the reads.
    await startSession('/work', {
      runtimePreference: 'durable',
      sessionFile: '/s.jsonl',
      requestId: 'r3',
    }).catch(() => undefined)
    // A declined file is never reopened or started over, and the check came first.
    expect(durable.resumeFrom).not.toHaveBeenCalled()
    expect(durable.start).not.toHaveBeenCalled()
    expect(order).toEqual(['canResume'])
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
