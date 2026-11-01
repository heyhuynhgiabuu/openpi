import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { forkMock, utilityForkMock } = vi.hoisted(() => ({
  forkMock: vi.fn(),
  utilityForkMock: vi.fn(),
}))

vi.mock('node:child_process', () => {
  const spawnSync = vi.fn(() => ({ status: 0 }))
  return {
    default: { fork: forkMock, spawnSync },
    fork: forkMock,
    spawnSync,
  }
})
vi.mock('electron', () => ({
  app: { isPackaged: false },
  utilityProcess: { fork: utilityForkMock },
}))

import { PiSidecarHost } from '../electron/pi/sidecarHost'

class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter()
  readonly stderr = new EventEmitter()
  readonly send = vi.fn()
  readonly kill = vi.fn()
  readonly pid = 123
}

const readyPayload = {
  cwd: '/workspace',
  sessionFile: '/workspace/session.jsonl',
  sessionId: 'session-1',
  sessionName: null,
  model: null,
  thinkingLevel: 'off',
}

describe('PiSidecarHost response routing', () => {
  let child: FakeChild
  let onMessage: ReturnType<typeof vi.fn>
  let host: PiSidecarHost

  beforeEach(() => {
    child = new FakeChild()
    forkMock.mockReset()
    forkMock.mockReturnValue(child)
    onMessage = vi.fn()
    host = new PiSidecarHost({ onMessage, onCrash: vi.fn() })
    host.start()
  })

  it('rejects a pending request immediately when its response is malformed', async () => {
    const request = host.request({ type: 'get_stats', requestId: 'stats-1' })
    child.emit('message', { type: 'stats_result', requestId: 'stats-1', stats: {} })

    await expect(request).rejects.toThrow(/malformed response/i)
    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'output_append' }))
  })

  it('rejects a valid but incompatible response type', async () => {
    const request = host.request({ type: 'get_models', requestId: 'models-1' })
    child.emit('message', {
      type: 'session_ready',
      requestId: 'models-1',
      payload: readyPayload,
    })

    await expect(request).rejects.toThrow(/incompatible request/i)
  })

  it('drops an orphaned session replacement result instead of forwarding stale state', () => {
    child.emit('message', {
      type: 'session_ready',
      requestId: 'timed-out-request',
      payload: readyPayload,
    })

    expect(onMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'session_ready' }))
    expect(onMessage).toHaveBeenCalledWith({
      type: 'output_append',
      line: expect.objectContaining({
        level: 'warn',
        text: expect.stringContaining('orphaned session replacement'),
      }),
    })
  })
})

/**
 * The pre-apply gate ships in `extraResources` and reaches the sidecar only through the fork
 * env (issue #80). These pin the two lines that deliver it: without them every other test
 * still passes, because `getResourceLoader` is mocked everywhere else.
 */
describe('PiSidecarHost shipped-asset env', () => {
  function forkEnv(): NodeJS.ProcessEnv {
    // A packaged build spawns through `utilityProcess.fork` (Electron's ASAR support) and a
    // dev build through `child_process.fork` with the system node, so read whichever ran.
    const call = [...forkMock.mock.calls, ...utilityForkMock.mock.calls].at(-1)
    if (!call) throw new Error('expected the sidecar to be forked')
    return (call[2] as { env?: NodeJS.ProcessEnv } | undefined)?.env ?? {}
  }

  beforeEach(() => {
    forkMock.mockReset()
    utilityForkMock.mockReset()
    forkMock.mockReturnValue(new FakeChild())
    utilityForkMock.mockReturnValue(new FakeChild())
  })

  it('passes the resources path when packaged', async () => {
    const electron = await import('electron')
    Object.defineProperty(electron.app, 'isPackaged', { value: true, configurable: true })
    try {
      Object.defineProperty(process, 'resourcesPath', {
        value: '/Applications/OpenPi.app/Contents/Resources',
        configurable: true,
      })
      new PiSidecarHost({ onMessage: vi.fn(), onCrash: vi.fn() }).start()

      expect(forkEnv().OPENPI_RESOURCES_PATH).toBe('/Applications/OpenPi.app/Contents/Resources')
    } finally {
      Object.defineProperty(electron.app, 'isPackaged', { value: false, configurable: true })
    }
  })

  it('removes an inherited resources path in a dev run, rather than passing it through', () => {
    // Pi's bash tool spawns with `{...process.env}`, so a dev run started from inside the
    // packaged app inherits its Resources path and would load that (older) copy too.
    const previous = process.env.OPENPI_RESOURCES_PATH
    process.env.OPENPI_RESOURCES_PATH = '/stale/from/packaged/app'
    try {
      new PiSidecarHost({ onMessage: vi.fn(), onCrash: vi.fn() }).start()

      expect(forkEnv().OPENPI_RESOURCES_PATH).toBeUndefined()
    } finally {
      if (previous === undefined) delete process.env.OPENPI_RESOURCES_PATH
      else process.env.OPENPI_RESOURCES_PATH = previous
    }
  })
})
