import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GateRegistry } from '../electron/remote/gates'
import { SseHub } from '../electron/remote/sse'

const hubs: SseHub[] = []
afterEach(() => {
  for (const hub of hubs.splice(0)) hub.stop()
  vi.restoreAllMocks()
})

function fixture() {
  const registry = new GateRegistry()
  const hub = new SseHub(registry)
  hubs.push(hub)
  const response = new ServerResponse(new IncomingMessage(new Socket()))
  const frames: string[] = []
  let buffered = 0
  let blocked = false
  vi.spyOn(response, 'write').mockImplementation((chunk) => {
    const frame = String(chunk)
    frames.push(frame)
    if (blocked) buffered += Buffer.byteLength(frame)
    return !blocked
  })
  vi.spyOn(response, 'writableLength', 'get').mockImplementation(() => buffered)
  const destroy = vi.spyOn(response, 'destroy').mockReturnValue(response)
  hub.attach(response, 1)
  return {
    hub,
    registry,
    response,
    frames,
    destroy,
    block: () => {
      blocked = true
    },
  }
}

describe('SSE flow control', () => {
  it('keeps a healthy client past 500 frames without drain listeners', () => {
    const { hub, response, frames } = fixture()
    for (let i = 0; i < 1000; i++) hub.onSessionEvent({ type: 'message_update' })
    expect(hub.clientCount()).toBe(1)
    expect(frames.filter((frame) => frame.includes('event: message_update'))).toHaveLength(1000)
    expect(response.listenerCount('drain')).toBe(0)
  })

  it('preserves events during transient backpressure', () => {
    const { hub, frames, block } = fixture()
    block()
    hub.onSessionEvent({ type: 'agent_start' })
    hub.onSessionEvent({ type: 'agent_end' })
    expect(frames.join('')).toContain('event: agent_end')
  })

  it('sends the current gate baseline when a client reconnects', () => {
    const { hub, registry } = fixture()
    const opened = registry.open({ kind: 'confirm', title: 't', summary: 's', ttlMs: 60_000 })
    const response = new ServerResponse(new IncomingMessage(new Socket()))
    const frames: string[] = []
    vi.spyOn(response, 'write').mockImplementation((chunk) => {
      frames.push(String(chunk))
      return true
    })
    vi.spyOn(response, 'destroy').mockReturnValue(response)

    hub.attach(response, 1)

    expect(frames.join('')).toContain('event: gate_update')
    expect(frames.join('')).toContain('"gates":[')
    expect(frames.join('')).toContain(`"id":"${opened.gate.id}"`)
    expect(frames.join('')).toContain(`"gateToken":"${opened.gateToken}"`)
  })

  it('destroys an over-budget consumer instead of losing events silently', () => {
    const { hub, destroy, block } = fixture()
    block()
    const event = { type: 'message_update', text: 'x'.repeat(32 * 1024) }
    for (let i = 0; i < 20; i++) hub.onSessionEvent(event)
    expect(hub.clientCount()).toBe(0)
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('drops only the revoked device and sends an initial snapshot', () => {
    const { hub, frames, destroy } = fixture()
    expect(frames.join('')).toContain('event: gate_update')
    expect(frames.join('')).toContain('"gates":[]')
    hub.dropDevice(2)
    expect(hub.clientCount()).toBe(1)
    hub.dropDevice(1)
    expect(hub.clientCount()).toBe(0)
    expect(destroy).toHaveBeenCalledOnce()
  })
})
