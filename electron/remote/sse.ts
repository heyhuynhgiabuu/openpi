/**
 * remote/sse — the session-event fan-out tap.
 *
 * One producer, two consumers: main already fans validated AgentSessionEvents
 * out to the desktop renderer (messages.ts); the remote stream subscribes to
 * the same dispatch so the phone sees the same envelopes. Events are filtered
 * to the P0 subset and serialized as Server-Sent Events. The gate registry
 * contributes a synthetic gate_update snapshot whenever a gate opens, settles,
 * or expires; every new stream also gets one immediately on attach so the PWA
 * can render the pending-gate badge without an extra round-trip.
 *
 * Transport notes: SSE is one-way (server → phone), which removes the
 * hand-rolled WS frame parser from the trust boundary entirely. The token
 * stays in the Authorization header — never a query string, so nothing
 * secret lands in logs. The PWA consumes this with fetch-streaming: native
 * EventSource cannot set custom headers.
 */

import type { ServerResponse } from 'node:http'
import type { GateRegistry, GateSnapshot } from './gates'

/** P0 event subset — mirroring the desktop envelope, nothing more. */
const REMOTE_EVENT_TYPES = new Set<string>([
  'agent_start',
  'agent_end',
  'message_start',
  'message_update',
  'message_end',
  'tool_execution_start',
  'tool_execution_update',
  'tool_execution_end',
  'queue_update',
])

const KEEPALIVE_MS = 15_000
/** A write backlog beyond this marks the consumer as slow; the stream is dropped. */
const MAX_BUFFERED_BYTES = 512 * 1024

interface SseClient {
  response: ServerResponse
  deviceId: number
}

export class SseHub {
  private clients = new Set<SseClient>()
  private keepalive: NodeJS.Timeout | null = null
  private unsubGate: (() => void) | null = null

  constructor(
    private readonly registry: GateRegistry,
    private readonly now: () => number = Date.now
  ) {}

  /** Wires gate registry changes into the stream; call once at server start. */
  start(): void {
    this.unsubGate = this.registry.onChange(() => {
      this.broadcast('gate_update', this.registry.listPending(this.now()))
    })
  }

  stop(): void {
    this.unsubGate?.()
    this.unsubGate = null
    if (this.keepalive) clearInterval(this.keepalive)
    this.keepalive = null
    for (const client of [...this.clients]) this.detach(client)
  }

  /**
   * Adopts an already-authenticated response as an SSE stream. server.ts has
   * settled the 200 + text/event-stream head before calling; from here the
   * stream is write-only — no request data is ever read again. The stream
   * opens with one gate snapshot so a reconnecting client is current at once.
   */
  attach(response: ServerResponse, deviceId: number): void {
    const client: SseClient = { response, deviceId }
    response.write('retry: 3000\n\n')
    this.clients.add(client)
    response.on('close', () => {
      this.clients.delete(client)
    })
    this.writeFrame(client, formatFrame('gate_update', this.registry.listPending(this.now())))
    if (this.clients.size === 1 && !this.keepalive) {
      this.keepalive = setInterval(() => this.keepaliveTick(), KEEPALIVE_MS)
      this.keepalive.unref()
    }
  }

  /** Closes every stream belonging to a device — revocation is immediate. */
  dropDevice(deviceId: number): void {
    for (const client of [...this.clients]) {
      if (client.deviceId === deviceId) this.detach(client)
    }
  }

  /** Fan-out hook called by main for every validated session event. */
  onSessionEvent(event: { type?: string }): void {
    const type = event.type ?? ''
    if (!REMOTE_EVENT_TYPES.has(type)) return
    this.broadcast(type, event)
  }

  clientCount(): number {
    return this.clients.size
  }

  private broadcast(type: string, data: unknown): void {
    const frame = formatFrame(type, data)
    for (const client of [...this.clients]) {
      this.writeFrame(client, frame)
    }
  }

  /** Node owns the queue; bound it in bytes without skipping deltas. */
  private writeFrame(client: SseClient, frame: string): void {
    if (client.response.writableLength + Buffer.byteLength(frame) > MAX_BUFFERED_BYTES) {
      this.detach(client)
      return
    }
    try {
      client.response.write(frame)
    } catch {
      this.detach(client)
    }
  }

  private keepaliveTick(): void {
    for (const client of [...this.clients]) {
      this.writeFrame(client, ': keepalive\n\n')
    }
  }

  private detach(client: SseClient): void {
    this.clients.delete(client)
    try {
      client.response.destroy()
    } catch {
      // Already destroyed.
    }
  }
}

function formatFrame(type: string, data: unknown): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`
}

export type { GateSnapshot }
