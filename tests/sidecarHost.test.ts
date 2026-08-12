import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { forkMock } = vi.hoisted(() => ({ forkMock: vi.fn() }))

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
  utilityProcess: { fork: vi.fn() },
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
