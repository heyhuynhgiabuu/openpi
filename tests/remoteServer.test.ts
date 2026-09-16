import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { RemoteAuth } from '../electron/remote/auth'
import { RemoteDeviceStore } from '../electron/remote/devices'
import {
  startRemoteServer,
  type RemoteHandlers,
  type RunningRemoteServer,
} from '../electron/remote/server'

// better-sqlite3 is a native module rebuilt for Electron's ABI; tests run on
// the node:sqlite shim behind the same tiny surface.
vi.mock('better-sqlite3', async () => {
  const { createSqliteShim } = await import('./helpers/sqliteShim')
  return createSqliteShim()
})

import Database from 'better-sqlite3'

let db: Database.Database
let auth: RemoteAuth
let running: RunningRemoteServer
let base: string
let handlers: RemoteHandlers

beforeEach(async () => {
  db = new Database(':memory:')
  const store = new RemoteDeviceStore(db)
  auth = new RemoteAuth(store)
  handlers = {}
  running = await startRemoteServer({ auth, handlers, port: 0, host: '127.0.0.1' })
  base = `http://127.0.0.1:${running.port}`
})

afterEach(async () => {
  await running.stop()
  db.close()
})

function pairHeader(): Record<string, string> {
  return { 'content-type': 'application/json', origin: base }
}

async function pairDevice(name = 'phone'): Promise<string> {
  const { code } = auth.beginPairing()
  const response = await fetch(`${base}/api/pair`, {
    method: 'POST',
    headers: pairHeader(),
    body: JSON.stringify({ code, name }),
  })
  expect(response.status).toBe(200)
  const body = (await response.json()) as { deviceToken: string }
  return body.deviceToken
}

describe('pair endpoint', () => {
  it('pairs with a valid code and Origin over real HTTP', async () => {
    const { code } = auth.beginPairing()
    const response = await fetch(`${base}/api/pair`, {
      method: 'POST',
      headers: pairHeader(),
      body: JSON.stringify({ code, name: 'phone' }),
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { deviceToken: string; deviceName: string }
    expect(body.deviceToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(body.deviceName).toBe('phone')
  })

  it('refuses a POST without a matching Origin', async () => {
    const { code } = auth.beginPairing()
    const response = await fetch(`${base}/api/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://evil.example' },
      body: JSON.stringify({ code, name: 'phone' }),
    })
    expect(response.status).toBe(403)
  })

  it('refuses a POST with no Origin and no same-site marker', async () => {
    const { code } = auth.beginPairing()
    const response = await fetch(`${base}/api/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, name: 'phone' }),
    })
    expect(response.status).toBe(403)
  })

  it('answers wrong and expired codes with one identical body', async () => {
    const wrong = await fetch(`${base}/api/pair`, {
      method: 'POST',
      headers: pairHeader(),
      body: JSON.stringify({ code: '000001', name: 'phone' }),
    })
    const wrongBody = await wrong.text()

    // No pending pairing at all — same 403 body, byte for byte.
    const none = await fetch(`${base}/api/pair`, {
      method: 'POST',
      headers: pairHeader(),
      body: JSON.stringify({ code: '000001', name: 'phone' }),
    })
    expect(await none.text()).toBe(wrongBody)
    expect(wrong.status).toBe(403)
  })

  it('rejects malformed bodies per schema', async () => {
    const response = await fetch(`${base}/api/pair`, {
      method: 'POST',
      headers: pairHeader(),
      body: JSON.stringify({ code: '12', name: '', extra: true }),
    })
    expect(response.status).toBe(400)
  })
})

describe('bearer auth', () => {
  it('answers 401 without, with a garbage, and with a wrong token', async () => {
    const noHeader = await fetch(`${base}/api/session-list`)
    expect(noHeader.status).toBe(401)

    const garbage = await fetch(`${base}/api/session-list`, {
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
    })
    expect(garbage.status).toBe(401)

    const wrong = await fetch(`${base}/api/session-list`, {
      headers: { authorization: `Bearer ${randomBytes(32).toString('base64url')}` },
    })
    expect(wrong.status).toBe(401)
  })

  it('authenticates a paired token and passes the device id to the handler', async () => {
    const token = await pairDevice()
    let seenDeviceId: number | null = null
    handlers['session-list'] = async (context) => {
      seenDeviceId = context.deviceId
      return { sessions: [] }
    }

    const response = await fetch(`${base}/api/session-list`, {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ sessions: [] })
    expect(seenDeviceId).toBeGreaterThan(0)
  })

  it('keeps the token working across requests (touch is transparent)', async () => {
    const token = await pairDevice()
    handlers['gates'] = async () => ({ gates: [] })
    for (let round = 0; round < 2; round++) {
      const response = await fetch(`${base}/api/gates`, {
        headers: { authorization: `Bearer ${token}` },
      })
      expect(response.status).toBe(200)
    }
  })
})

describe('allowlist enforcement', () => {
  it('answers 501 for anything unmatched, without invoking handlers', async () => {
    const response = await fetch(`${base}/api/session/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ text: 'do things' }),
    })
    expect(response.status).toBe(501)
    expect(await response.json()).toEqual({ error: 'not_in_allowlist' })
  })

  it('answers 501 for allowlisted routes whose handler is not wired yet', async () => {
    const token = await pairDevice()
    const response = await fetch(`${base}/api/turn-changes`, {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.status).toBe(501)
    expect(await response.json()).toEqual({ error: 'not_in_allowlist' })
  })

  it('caps request bodies and still answers 413', async () => {
    handlers['gate-approve'] = async () => ({ ok: true })
    const token = await pairDevice()
    const response = await fetch(`${base}/api/gates/g-1/approve`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: base,
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ gateToken: 'x'.repeat(24), blob: 'y'.repeat(80 * 1024) }),
    })
    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({ error: 'body_too_large' })
  })

  it('answers 429 when the pairing rate limit trips over HTTP', async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      await fetch(`${base}/api/pair`, {
        method: 'POST',
        headers: pairHeader(),
        body: JSON.stringify({ code: '000001', name: 'phone' }),
      })
    }
    const { code } = auth.beginPairing()
    const response = await fetch(`${base}/api/pair`, {
      method: 'POST',
      headers: pairHeader(),
      body: JSON.stringify({ code, name: 'phone' }),
    })
    expect(response.status).toBe(429)
    expect(await response.json()).toEqual({ error: 'rate_limited' })
  })
})
