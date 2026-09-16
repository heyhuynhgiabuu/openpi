/**
 * remote/serverHttp — body reading and JSON responses for the remote server.
 *
 * Split from server.ts for the 300-LOC rule; the security properties stay
 * binding here: 64KB cap enforced before parse and before auth (an
 * unauthenticated source can never hold a parse in flight), over-cap bodies
 * are answered 413 before teardown, and responses are JSON-only, no-store,
 * nosniff, with no reflected values.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

export const MAX_BODY_BYTES = 64 * 1024

export type BodyParse = { ok: true; body: unknown } | { ok: false; status: number; error: string }

export function readJsonBody(request: IncomingMessage): Promise<BodyParse> {
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

export function respond(response: ServerResponse, status: number, body: unknown): void {
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
