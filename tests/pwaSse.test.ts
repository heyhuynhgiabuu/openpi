import { describe, expect, it } from 'vitest'
import { SseParser } from '../pwa/sse'

function collect(chunks: string[]): ReturnType<SseParser['push']> {
  const parser = new SseParser()
  return chunks.flatMap((chunk) => parser.push(chunk))
}

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
