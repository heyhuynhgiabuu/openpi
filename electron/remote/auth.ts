/**
 * remote/auth — device pairing and request authentication.
 *
 * The pairing code is a CSPRNG six-digit number, single-use and short-lived;
 * the rate limits are what make six digits safe to type. The real secret is
 * the 256-bit device token issued on a successful pair — main keeps only its
 * SHA-256 hash and compares with crypto.timingSafeEqual.
 *
 * All outcomes are typed results; nothing here throws for expected failures.
 *
 * External pairing contract (binding for the HTTP layer): `bad_code` outcomes
 * — wrong, expired, or missing code alike — MUST map to one byte-identical 403
 * body, so the response never reveals whether a pairing was pending. Only
 * `rate_limited` may answer differently (429).
 */

import { createHash, randomInt, timingSafeEqual } from 'node:crypto'
import {
  hashDeviceToken,
  generateDeviceToken,
  RemoteDeviceStore,
  type RemoteDeviceRow,
} from './devices'

const PAIRING_TTL_MS = 5 * 60_000
const ATTEMPTS_WINDOW_MS = 5 * 60_000
const MAX_ATTEMPTS_PER_IP = 5
const GLOBAL_LOCKOUT_ATTEMPTS = 20

export type PairResult =
  | { ok: true; deviceToken: string; device: RemoteDeviceRow }
  | { ok: false; reason: 'rate_limited' | 'bad_code' }

interface Attempt {
  ip: string
  at: number
}

interface PendingPairing {
  code: string
  expiresAt: number
}

export class RemoteAuth {
  private readonly store: RemoteDeviceStore
  private readonly now: () => number
  private pending: PendingPairing | null = null
  private attempts: Attempt[] = []

  constructor(store: RemoteDeviceStore, now: () => number = Date.now) {
    this.store = store
    this.now = now
  }

  /** Starts the one allowed pending pairing. Any previous one is replaced. */
  beginPairing(): { code: string; expiresAt: number } {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    this.pending = { code, expiresAt: this.now() + PAIRING_TTL_MS }
    return { code, expiresAt: this.pending.expiresAt }
  }

  pair(code: string, deviceName: string, ip: string): PairResult {
    if (this.isRateLimited(ip)) return { ok: false, reason: 'rate_limited' }
    this.recordAttempt(ip)

    const pending = this.pending
    if (!pending) return { ok: false, reason: 'bad_code' }
    if (this.now() > pending.expiresAt) {
      this.pending = null
      return { ok: false, reason: 'bad_code' }
    }
    // Constant-time over a six-digit code is not load-bearing (rate limits
    // are), but it costs nothing and keeps the hot path uniform.
    if (!safeEqualStrings(code, pending.code)) {
      return { ok: false, reason: 'bad_code' }
    }

    // Single use: consume before anything else can observe it.
    this.pending = null
    const deviceToken = generateDeviceToken()
    const tokenHash = hashDeviceToken(deviceToken)
    const id = this.store.create(deviceName, tokenHash, new Date(this.now()))
    const device = this.store.list().find((row) => row.id === id)
    if (!device) return { ok: false, reason: 'bad_code' }
    return { ok: true, deviceToken, device }
  }

  /** Verifies a bearer token and touches the device's last-seen stamp. */
  verify(token: string): RemoteDeviceRow | null {
    const tokenHash = createHash('sha256').update(token, 'utf8').digest()
    for (const row of this.store.list()) {
      if (row.revokedAt !== null) continue
      const stored = Buffer.from(row.tokenHash, 'hex')
      if (stored.length === tokenHash.length && timingSafeEqual(stored, tokenHash)) {
        this.store.touch(row.id, new Date(this.now()))
        // Fresh read so the returned row carries the new last-seen stamp.
        return this.store.findActiveByHash(tokenHash.toString('hex'))
      }
    }
    return null
  }

  /** Cancels a pending pairing without consuming the attempt budget. */
  cancelPending(): void {
    this.pending = null
  }

  private isRateLimited(ip: string): boolean {
    const cutoff = this.now() - ATTEMPTS_WINDOW_MS
    this.attempts = this.attempts.filter((attempt) => attempt.at >= cutoff)
    const byIp = this.attempts.filter((attempt) => attempt.ip === ip).length
    if (byIp >= MAX_ATTEMPTS_PER_IP) return true
    if (this.attempts.length >= GLOBAL_LOCKOUT_ATTEMPTS) return true
    return false
  }

  private recordAttempt(ip: string): void {
    this.attempts.push({ ip, at: this.now() })
  }
}

function safeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) {
    // Equalize work before failing: length alone must not leak the answer.
    timingSafeEqual(bufA, bufA)
    return false
  }
  return timingSafeEqual(bufA, bufB)
}
