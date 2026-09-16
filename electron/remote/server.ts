/**
 * remote/server — the P0 HTTP server.
 *
 * Request order is the security contract (see the design doc):
 *   1. allowlist match — anything unmatched answers 501 without side effects
 *   2. Origin check on POST (CSRF; GETs are auth-guarded instead)
 *   3. body size cap and JSON parse
 *   4. bearer auth, except the pairing route
 *   5. handler dispatch; a route whose handler is not wired yet answers 501
 *
 * Responses are always JSON, carry no CORS headers, and are marked no-store.
 * The server exists only while the user has Remote enabled in Settings.
 */

import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { createServer } from 'node:http'
import { matchRemoteRoute, type RemoteHandlerId } from './allowlist'
import type { RemoteAuth } from './auth'
import type { SseHub } from './sse'
import { pairRequestSchema } from './protocol'
import { readJsonBody, respond, type BodyParse } from './serverHttp'
import { MAX_BODY_BYTES } from './serverHttp'

export type { BodyParse }

/** Read-model/stream handlers, supplied by later slices; absent = 501 for now. */
export type RemoteHandlers = Partial<Record<Exclude<RemoteHandlerId, 'pair'>, RemoteHandler>>

export interface RemoteHandler {
  (context: RemoteRequestContext): Promise<unknown>
}

export interface RemoteRequestContext {
  /** Decoded path parameter, keyed as declared in the allowlist pattern. */
  params: Record<string, string>
  /** Parsed JSON body (POST only; validated further by the handler). */
  body: unknown
  /** The authenticated device, when the route is bearer-guarded. */
  deviceId: number
}

export interface RemoteServerOptions {
  auth: RemoteAuth
  handlers: RemoteHandlers
  port: number
  host?: string
  /** SSE hub for the /api/events stream; authenticated before attach. */
  hub?: SseHub
}

export interface RunningRemoteServer {
  port: number
  stop: () => Promise<void>
}

// ── lifecycle ────────────────────────────────────────────────────────────────

export function startRemoteServer(options: RemoteServerOptions): Promise<RunningRemoteServer> {
  const server = createServer((request, response) => {
    void handleRequest(options, request, response)
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, options.host ?? '0.0.0.0', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : options.port
      resolve({ port, stop: () => closeServer(server) })
    })
  })
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    // The kill switch must not wait on open connections: a stalled request or
    // a live SSE stream would hold close() until Node's 300s requestTimeout.
    server.close((error) => (error ? reject(error) : resolve()))
    server.closeAllConnections()
  })
}

// ── request pipeline ─────────────────────────────────────────────────────────

async function handleRequest(
  options: RemoteServerOptions,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  try {
    const pathname = (request.url ?? '/').split('?')[0]
    const match = matchRemoteRoute(request.method ?? 'GET', pathname)
    if (!match) {
      respond(response, 501, { error: 'not_in_allowlist' })
      return
    }

    if (match.route.handler === 'pair') {
      await handlePair(options, request, response)
      return
    }

    if (match.route.method === 'POST') {
      const originError = checkPostOrigin(request)
      if (originError) {
        respond(response, 403, { error: originError })
        return
      }
    }

    let body: unknown = undefined
    if (match.route.method === 'POST') {
      const parsed = await readJsonBody(request)
      if (!parsed.ok) {
        respond(response, parsed.status, { error: parsed.error })
        return
      }
      body = parsed.body
    }

    const device = authenticate(options, request)
    if (!device) {
      // Operationally visible, never in the response body: no token material.
      console.warn(
        `[openpi:remote] 401 ${request.method} ${pathname} from ${request.socket.remoteAddress ?? 'unknown'}`
      )
      respond(response, 401, { error: 'unauthorized' })
      return
    }

    // The SSE stream is adopted here, after auth: from this point the
    // response is write-only and the request is never read again.
    if (match.route.handler === 'events') {
      if (!options.hub) {
        respond(response, 501, { error: 'not_in_allowlist' })
        return
      }
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        connection: 'keep-alive',
      })
      options.hub.attach(response, device.id)
      return
    }

    const handler = options.handlers[match.route.handler]
    if (!handler) {
      // Allowlisted but not wired yet (read models arrive in a later slice).
      respond(response, 501, { error: 'not_in_allowlist' })
      return
    }

    const result = await handler({ params: match.params, body, deviceId: device.id })
    if (isStatusResult(result)) {
      respond(response, result.status, result.body)
      return
    }
    respond(response, 200, result ?? { ok: true })
  } catch {
    // Any unhandled failure answers a bare 500; no internals leak.
    console.warn(
      `[openpi:remote] 500 ${request.method} ${(request.url ?? '/').split('?')[0]} from ${request.socket.remoteAddress ?? 'unknown'}`
    )
    respond(response, 500, { error: 'internal' })
  }
}

// ── pair endpoint (built-in; the only bearer-free route) ─────────────────────

async function handlePair(
  options: RemoteServerOptions,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  if (request.method !== 'POST') {
    respond(response, 501, { error: 'not_in_allowlist' })
    return
  }
  const originError = checkPostOrigin(request)
  if (originError) {
    respond(response, 403, { error: originError })
    return
  }
  const parsed = await readJsonBody(request)
  if (!parsed.ok) {
    respond(response, parsed.status, { error: parsed.error })
    return
  }
  const decoded = pairRequestSchema.safeParse(parsed.body)
  if (!decoded.success) {
    respond(response, 400, { error: 'invalid_request' })
    return
  }
  const ip = request.socket.remoteAddress ?? 'unknown'
  const result = options.auth.pair(decoded.data.code, decoded.data.name, ip)
  if (!result.ok) {
    // bad_code answers byte-identically whatever the truth was; rate limits
    // get their own status so clients can back off.
    if (result.reason === 'rate_limited') {
      respond(response, 429, { error: 'rate_limited' })
    } else {
      respond(response, 403, { error: 'bad_code' })
    }
    return
  }
  // The device token is the one secret the response ever carries; never echo
  // the stored hash.
  respond(response, 200, { deviceToken: result.deviceToken, deviceName: result.device.name })
}

// ── auth and origin ──────────────────────────────────────────────────────────

function authenticate(
  options: RemoteServerOptions,
  request: IncomingMessage
): { id: number } | null {
  const header = request.headers.authorization
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null
  const token = header.slice('Bearer '.length)
  if (token.length === 0 || token.length > 512) return null
  const device = options.auth.verify(token)
  return device ? { id: device.id } : null
}

function checkPostOrigin(request: IncomingMessage): string | null {
  const origin = request.headers.origin
  if (typeof origin === 'string' && origin.length > 0) {
    const host = request.headers.host
    return host && origin === `http://${host}` ? null : 'forbidden_origin'
  }
  const fetchSite = request.headers['sec-fetch-site']
  if (fetchSite === 'same-origin') return null
  return 'forbidden_origin'
}

// ── responses ────────────────────────────────────────────────────────────────

function isStatusResult(value: unknown): value is { status: number; body: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    typeof (value as { status: unknown }).status === 'number' &&
    'body' in value
  )
}
