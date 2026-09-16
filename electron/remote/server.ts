/**
 * remote/server — the P0 HTTP server.
 *
 * Request order is the security contract (see the design doc):
 *   1. allowlist match — anything unmatched answers 501 without side effects
 *   2. body size cap
 *   3. Origin check on POST (CSRF; GETs are auth-guarded instead)
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
import { pairRequestSchema } from './protocol'

export const MAX_BODY_BYTES = 64 * 1024

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

    const handler = options.handlers[match.route.handler]
    if (!handler) {
      // Allowlisted but not wired yet (read models arrive in a later slice).
      respond(response, 501, { error: 'not_in_allowlist' })
      return
    }

    const result = await handler({ params: match.params, body, deviceId: device.id })
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

// ── body reading ─────────────────────────────────────────────────────────────

type BodyParse = { ok: true; body: unknown } | { ok: false; status: number; error: string }

function readJsonBody(request: IncomingMessage): Promise<BodyParse> {
  return new Promise((resolve) => {
    const declared = Number(request.headers['content-length'] ?? '0')
    if (!Number.isFinite(declared) || declared < 0 || declared > MAX_BODY_BYTES) {
      resolve({ ok: false, status: 413, error: 'body_too_large' })
      request.resume()
      return
    }
    const chunks: Buffer[] = []
    let received = 0
    let done = false
    const finish = (result: BodyParse) => {
      if (done) return
      done = true
      request.off('data', onData)
      request.off('end', onEnd)
      request.off('error', onError)
      resolve(result)
    }
    const onData = (chunk: Buffer): void => {
      if (done) return
      received += chunk.length
      if (received > MAX_BODY_BYTES) {
        // Answer first, then drain the rest: destroying the socket before the
        // response would leave the client with no status at all. Node closes
        // the connection itself when a response ends mid-body.
        request.resume()
        finish({ ok: false, status: 413, error: 'body_too_large' })
        return
      }
      chunks.push(chunk)
    }
    const onEnd = (): void => {
      if (done) return
      if (received === 0) {
        finish({ ok: true, body: undefined })
        return
      }
      try {
        finish({ ok: true, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) })
      } catch {
        finish({ ok: false, status: 400, error: 'invalid_json' })
      }
    }
    const onError = (): void => finish({ ok: false, status: 400, error: 'invalid_json' })

    request.on('data', onData)
    request.on('end', onEnd)
    request.on('error', onError)
  })
}

// ── responses ────────────────────────────────────────────────────────────────

function respond(response: ServerResponse, status: number, body: unknown): void {
  if (response.headersSent) {
    response.end()
    return
  }
  response.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  response.end(JSON.stringify(body))
}
