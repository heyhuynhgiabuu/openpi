/**
 * remote/sse — the session-event fan-out tap.
 *
 * One producer, two consumers: main already fans validated AgentSessionEvents
 * out to the desktop renderer (messages.ts); the remote stream subscribes to
 * the same dispatch so the phone sees the same envelopes. Events are filtered
 * to the P0 subset and serialized as Server-Sent Events. The gate registry
 * contributes a synthetic gate_update snapshot whenever a gate opens, settles,
 * or expires.
 *
 * Transport notes: SSE is one-way (server → phone), which removes the
 * hand-rolled WS frame parser from the trust boundary entirely. The token
 * stays in the Authorization header — never a query string, so nothing
 * secret lands in logs.
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
/** An SSE stream is unbounded; a hard cap bounds memory per phone. */
const MAX_QUEUED_FRAMES = 500

interface SseClient {
  response: ServerResponse
  queued: number
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
   * stream is write-only — no request data is ever read again.
   */
  attach(response: ServerResponse): void {
    const client: SseClient = { response, queued: 0 }
    response.write('retry: 3000\n\n')
    this.clients.add(client)
    response.on('close', () => {
      this.clients.delete(client)
    })
    if (this.clients.size === 1 && !this.keepalive) {
      this.keepalive = setInterval(() => this.keepaliveTick(), KEEPALIVE_MS)
      this.keepalive.unref()
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
      if (client.queued >= MAX_QUEUED_FRAMES) {
        // Slow consumer: drop the stream rather than queue without bound.
        this.detach(client)
        continue
      }
      try {
        client.response.write(frame)
        client.queued++
        client.response.once('drain', () => {
          client.queued = Math.max(0, client.queued - 1)
        })
      } catch {
        this.detach(client)
      }
    }
  }

  private keepaliveTick(): void {
    for (const client of [...this.clients]) {
      try {
        client.response.write(': keepalive\n\n')
      } catch {
        this.detach(client)
      }
    }
  }

  private detach(client: SseClient): void {
    this.clients.delete(client)
    try {
      client.response.end()
    } catch {
      // Already destroyed.
    }
  }
}

function formatFrame(type: string, data: unknown): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`
}

export type { GateSnapshot }
