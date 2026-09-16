import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RemoteAuth } from '../electron/remote/auth'
import { RemoteDeviceStore, hashDeviceToken } from '../electron/remote/devices'

// better-sqlite3 is a native module rebuilt for Electron's ABI; tests run on
// the node:sqlite shim behind the same tiny surface.
vi.mock('better-sqlite3', async () => {
  const { createSqliteShim } = await import('./helpers/sqliteShim')
  return createSqliteShim()
})

import Database from 'better-sqlite3'

let db: Database.Database
let store: RemoteDeviceStore
let nowMs: number
let auth: RemoteAuth
const IP = '100.64.0.2'

beforeEach(() => {
  db = new Database(':memory:')
  store = new RemoteDeviceStore(db)
  nowMs = 1_700_000_000_000
  auth = new RemoteAuth(store, () => nowMs)
})

afterEach(() => {
  db.close()
})

function beginAndPair(name = 'phone'): string {
  const { code } = auth.beginPairing()
  const result = auth.pair(code, name, IP)
  if (!result.ok) throw new Error(`pairing failed: ${result.reason}`)
  return result.deviceToken
}

describe('pairing', () => {
  it('issues a six-digit single-use code that yields a 256-bit token', () => {
    const { code } = auth.beginPairing()
    expect(code).toMatch(/^\d{6}$/)

    const result = auth.pair(code, 'phone', IP)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // base64url of 32 bytes is 43 characters.
    expect(result.deviceToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(hashDeviceToken(result.deviceToken)).toHaveLength(64)

    // Single use: the same code is dead after one success.
    const replay = auth.pair(code, 'again', IP)
    expect(replay).toEqual({ ok: false, reason: 'bad_code' })
  })

  it('stores only the hash — the raw token never touches the database', () => {
    const token = beginAndPair()
    const row = db.prepare('select token_hash from remote_devices').get() as {
      token_hash: string
    }
    expect(row.token_hash).toBe(hashDeviceToken(token))
    expect(JSON.stringify(db.prepare('select * from remote_devices').all())).not.toContain(token)
  })

  it('refuses a wrong code without consuming the pending one', () => {
    const { code } = auth.beginPairing()
    expect(auth.pair('000001', 'phone', IP)).toEqual({ ok: false, reason: 'bad_code' })
    // Still pending: the correct code works on the next try.
    expect(auth.pair(code, 'phone', IP).ok).toBe(true)
  })

  it('expires the code after five minutes', () => {
    const { code } = auth.beginPairing()
    nowMs += 5 * 60_000 + 1
    expect(auth.pair(code, 'phone', IP)).toEqual({ ok: false, reason: 'bad_code' })
  })
})

describe('pairing rate limits', () => {
  it('cuts an IP off after five attempts in the window', () => {
    auth.beginPairing()
    for (let attempt = 0; attempt < 5; attempt++) {
      auth.pair('000001', 'phone', IP)
    }
    expect(auth.pair('000001', 'phone', IP)).toEqual({ ok: false, reason: 'rate_limited' })
  })

  it('treats wrong and expired codes identically — no state oracle', () => {
    const { code } = auth.beginPairing()
    expect(auth.pair('000001', 'phone', IP)).toEqual({ ok: false, reason: 'bad_code' })
    nowMs += 5 * 60_000 + 1
    // Expired now, but the response must be indistinguishable from a wrong
    // code so the endpoint never reveals whether a pairing was pending.
    expect(auth.pair(code, 'phone', IP)).toEqual({ ok: false, reason: 'bad_code' })
  })

  it('lifts the global lockout once the window passes', () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      auth.pair('000001', `ip-${attempt}`, `100.64.0.${attempt + 1}`)
    }
    nowMs += 5 * 60_000 + 1
    const { code } = auth.beginPairing()
    expect(auth.pair(code, 'phone', '100.64.9.9').ok).toBe(true)
  })

  it('replaces a still-pending pairing when pairing begins again', () => {
    const first = auth.beginPairing()
    const second = auth.beginPairing()
    expect(auth.pair(first.code, 'phone', IP)).toEqual({ ok: false, reason: 'bad_code' })
    expect(auth.pair(second.code, 'phone', IP).ok).toBe(true)
  })

  it('locks everyone out after twenty attempts across IPs', () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      auth.pair('000001', `ip-${attempt}`, `100.64.0.${attempt + 1}`)
    }
    const { code } = auth.beginPairing()
    expect(auth.pair(code, 'phone', '100.64.9.9')).toEqual({ ok: false, reason: 'rate_limited' })
  })
})

describe('token verification', () => {
  it('verifies a valid token and touches last-seen', () => {
    const token = beginAndPair()
    const device = auth.verify(token)
    if (!device) throw new Error('expected the token to verify')
    expect(device.name).toBe('phone')
    expect(device.lastSeenAt).toBe(new Date(nowMs).toISOString())
  })

  it('rejects unknown tokens', () => {
    beginAndPair()
    expect(auth.verify('not-a-real-token')).toBeNull()
  })

  it('rejects a revoked token immediately', () => {
    const token = beginAndPair()
    const device = auth.verify(token)
    if (!device) throw new Error('expected the token to verify')

    expect(store.revoke(device.id, new Date(nowMs))).toBe(true)
    expect(auth.verify(token)).toBeNull()
  })
})
