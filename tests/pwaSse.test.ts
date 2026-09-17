import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearToken, storeToken, storedToken } from '../pwa/api'
import { openEventStream, SseParser, type SseStatus } from '../pwa/sse'

function collect(chunks: string[]): ReturnType<SseParser['push']> {
  const parser = new SseParser()
  return chunks.flatMap((chunk) => parser.push(chunk))
}

afterEach(() => {
  clearToken()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('pwa sse parser', () => {
  it('parses complete frames', () => {
    const frames = collect(['event: agent_start\ndata: {"type":"agent_start"}\n\n'])
    expect(frames).toEqual([{ event: 'agent_start', data: { type: 'agent_start' } }])
  })

  it('reassembles frames split across chunks', () => {
    const frames = collect(['event: gate_upd', 'ate\ndata: {"gates":', '[{"id":"g1"}]}\n\n'])
    expect(frames).toEqual([{ event: 'gate_update', data: { gates: [{ id: 'g1' }] } }])
  })

  it('skips keepalive comments and empty frames', () => {
    expect(collect([': keepalive\n\n', '\n\n', 'event: x\ndata: 1\n\n'])).toEqual([
      { event: 'x', data: 1 },
    ])
  })

  it('drops frames with invalid JSON instead of throwing', () => {
    expect(collect(['event: x\ndata: {broken\n\n'])).toEqual([])
  })

  it('carries multiple data lines as concatenated JSON text', () => {
    const frames = collect(['event: m\ndata: {"a":\ndata: 1}\n\n'])
    expect(frames).toEqual([{ event: 'm', data: { a: 1 } }])
  })
})

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve()
}

describe('pwa sse lifecycle', () => {
  it('reconnects after a dropped stream and consumes the fresh gate snapshot', async () => {
    vi.useFakeTimers()
    try {
      storeToken('live-token')
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(
          new Response('event: gate_update\ndata: {"gates":[{"id":"old"}]}\n\n', {
            status: 200,
          })
        )
        .mockResolvedValueOnce(
          new Response('event: gate_update\ndata: {"gates":[{"id":"fresh"}]}\n\n', {
            status: 200,
          })
        )
      vi.stubGlobal('fetch', fetcher)
      const statuses: SseStatus[] = []
      const frames: unknown[] = []

      const close = openEventStream(
        (frame) => frames.push(frame.data),
        (status) => statuses.push(status)
      )
      await flushMicrotasks()
      expect(frames).toEqual([{ gates: [{ id: 'old' }] }])
      expect(statuses).toEqual(['connecting', 'connected', 'reconnecting'])

      await vi.advanceTimersByTimeAsync(1000)
      await flushMicrotasks()
      expect(frames).toEqual([{ gates: [{ id: 'old' }] }, { gates: [{ id: 'fresh' }] }])
      expect(statuses).toEqual([
        'connecting',
        'connected',
        'reconnecting',
        'connected',
        'reconnecting',
      ])
      expect(fetcher).toHaveBeenCalledTimes(2)
      close()
      expect(statuses.at(-1)).toBe('closed')
    } finally {
      vi.useRealTimers()
    }
  })

  it('closes on unauthorized without retrying or retaining the token', async () => {
    storeToken('revoked-token')
    const fetcher = vi.fn(async () => ({ status: 401, ok: false, body: null }))
    vi.stubGlobal('fetch', fetcher)
    const statuses: SseStatus[] = []

    const close = openEventStream(
      () => {},
      (status) => statuses.push(status)
    )
    await vi.waitFor(() => expect(statuses).toEqual(['connecting', 'closed']))

    expect(fetcher).toHaveBeenCalledOnce()
    expect(storedToken()).toBeNull()
    close()
  })
})
