/**
 * remote/gates — the pending-gate registry.
 *
 * Every desktop confirmation that P0 exposes remotely (high-risk mutations,
 * protected paths, pre-apply review, extension ctx.ui confirms) registers here
 * alongside its dialog. The desktop modal and a paired device resolve the SAME
 * promise: first settle wins, the loser's answer is tombstoned. Remote
 * resolutions must present the gate's one-time token; the desktop settles
 * in-process without one.
 *
 * The registry holds no decision logic. Out-of-range approvedIndexes are the
 * caller's obligation (the gate schema documents this); the registry only
 * arbitrates who answers and whether the answer is still acceptable.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto'

export type GateKind = 'confirm' | 'input'

export interface GateSnapshot {
  id: string
  kind: GateKind
  title: string
  summary: string
  /** Opaque review payload (pre-apply hunks); rendered read-only remotely. */
  payload?: unknown
  createdAt: number
  expiresAt: number
}

export interface GateOutcome {
  approved: boolean
  /** For 'input' gates: approved hunk indexes. */
  approvedIndexes?: number[]
  via: 'desktop' | 'remote'
}

export interface OpenedGate {
  gate: GateSnapshot
  gateToken: string
  wait: () => Promise<GateOutcome | { expired: true }>
}

export type GateSettleResult =
  | { ok: true }
  | { ok: false; reason: 'unknown_gate' | 'already_resolved' | 'bad_token' | 'expired' }

export type RemoteGateDecision =
  | { ok: true; outcome: GateOutcome }
  | { ok: false; reason: 'unknown_gate' | 'already_resolved' | 'bad_token' | 'expired' }

interface Entry {
  snapshot: GateSnapshot
  gateToken: string
  settle: (outcome: GateOutcome | { expired: true }) => void
}

interface Tombstone {
  gateToken: string
  expiresAt: number
}

/** Bounded tombstones so a settled gate answers already_resolved, not unknown. */
const MAX_TOMBSTONES = 128

export class GateRegistry {
  private entries = new Map<string, Entry>()
  private tombstones = new Map<string, Tombstone>()
  private listeners = new Set<() => void>()

  /**
   * Registers a gate. `ttlMs` should match the underlying dialog's own expiry;
   * an unanswered gate resolves { expired: true } when swept past it.
   */
  open(input: {
    kind: GateKind
    title: string
    summary: string
    payload?: unknown
    ttlMs: number
  }): OpenedGate {
    const now = Date.now()
    const gate: GateSnapshot = {
      id: randomBytes(12).toString('base64url'),
      kind: input.kind,
      title: input.title,
      summary: input.summary,
      createdAt: now,
      expiresAt: now + input.ttlMs,
    }
    if (input.payload !== undefined) gate.payload = input.payload
    const gateToken = randomBytes(24).toString('base64url')

    const promise = new Promise<GateOutcome | { expired: true }>((resolve) => {
      this.entries.set(gate.id, {
        snapshot: gate,
        gateToken,
        settle: resolve,
      })
    })
    this.notify()

    return { gate, gateToken, wait: () => promise }
  }

  /** Desktop-side settlement: in-process, no gate token required. */
  settleLocally(id: string, outcome: GateOutcome): boolean {
    const entry = this.entries.get(id)
    if (!entry) return false
    this.tombstone(id, entry)
    entry.settle(outcome)
    this.notify()
    return true
  }

  /** Remote-side settlement: requires the gate's one-time token. */
  resolveRemotely(
    id: string,
    gateToken: string,
    decision: { approved: boolean; approvedIndexes?: number[] }
  ): RemoteGateDecision {
    const entry = this.entries.get(id)
    if (!entry) {
      // Settled gates keep answering already_resolved to the right token;
      // expired gates answer expired; anything else is indistinguishable from
      // an unknown gate.
      const settled = this.tombstones.get(id)
      if (settled !== undefined && safeEqualStrings(settled.gateToken, gateToken)) {
        if (Date.now() > settled.expiresAt) return { ok: false, reason: 'expired' }
        return { ok: false, reason: 'already_resolved' }
      }
      return { ok: false, reason: 'unknown_gate' }
    }
    if (!safeEqualStrings(entry.gateToken, gateToken)) {
      return { ok: false, reason: 'bad_token' }
    }
    if (Date.now() > entry.snapshot.expiresAt) {
      this.tombstone(id, entry)
      entry.settle({ expired: true })
      this.notify()
      return { ok: false, reason: 'expired' }
    }
    // Tombstone first: a second resolution attempt — desktop or remote — sees
    // already_resolved instead of double-resolving the promise.
    this.tombstone(id, entry)
    const outcome: GateOutcome = { approved: decision.approved, via: 'remote' }
    if (decision.approvedIndexes !== undefined) outcome.approvedIndexes = decision.approvedIndexes
    entry.settle(outcome)
    this.notify()
    return { ok: true, outcome }
  }

  listPending(now = Date.now()): GateSnapshot[] {
    const pending: GateSnapshot[] = []
    let swept = false
    for (const [id, entry] of this.entries) {
      if (now > entry.snapshot.expiresAt) {
        this.tombstone(id, entry)
        entry.settle({ expired: true })
        swept = true
      } else {
        pending.push(entry.snapshot)
      }
    }
    // Notify once after the loop: settle() must not re-enter this Map.
    if (swept) this.notify()
    return pending
  }

  /**
   * Pending gates with their one-time tokens, for bearer-gated remote
   * surfaces only (GET /api/gates and the SSE stream): a paired device needs
   * the token to answer the gate. Settled gates never appear here.
   */
  pendingWithTokens(now = Date.now()): Array<GateSnapshot & { gateToken: string }> {
    return this.listPending(now).map((gate) => {
      const entry = this.entries.get(gate.id)
      // listPending just swept expired entries, so an entry must exist here.
      if (!entry) return { ...gate, gateToken: '' }
      return { ...gate, gateToken: entry.gateToken }
    })
  }

  /** Change signal for the event stream; fires on open, settle, and expiry sweeps. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }

  private tombstone(id: string, entry: Entry): void {
    this.entries.delete(id)
    this.tombstones.set(id, { gateToken: entry.gateToken, expiresAt: entry.snapshot.expiresAt })
    while (this.tombstones.size > MAX_TOMBSTONES) {
      const oldest = this.tombstones.keys().next().value
      if (oldest === undefined) break
      this.tombstones.delete(oldest)
    }
  }
}

function safeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA)
    return false
  }
  return timingSafeEqual(bufA, bufB)
}
