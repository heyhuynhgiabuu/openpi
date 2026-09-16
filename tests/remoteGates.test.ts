import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GateRegistry, type GateOutcome } from '../electron/remote/gates'

describe('GateRegistry', () => {
  let registry: GateRegistry

  beforeEach(() => {
    vi.useFakeTimers()
    registry = new GateRegistry()
    vi.setSystemTime(1_700_000_000_000)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function openConfirm(ttlMs = 60_000) {
    return registry.open({ kind: 'confirm', title: 't', summary: 's', ttlMs })
  }

  it('resolves through the same promise for desktop and remote settlement', async () => {
    const opened = openConfirm()
    const remote = registry.resolveRemotely(opened.gate.id, opened.gateToken, {
      approved: true,
    })
    expect(remote.ok).toBe(true)
    await expect(opened.wait()).resolves.toEqual({ approved: true, via: 'remote' })
  })

  it('tombstones the first winner and answers already_resolved to the loser', async () => {
    const opened = openConfirm()
    const desktopWon = registry.settleLocally(opened.gate.id, {
      approved: false,
      via: 'desktop',
    })
    expect(desktopWon).toBe(true)

    const remoteLost = registry.resolveRemotely(opened.gate.id, opened.gateToken, {
      approved: true,
    })
    expect(remoteLost).toEqual({ ok: false, reason: 'already_resolved' })
    await expect(opened.wait()).resolves.toEqual({ approved: false, via: 'desktop' })
  })

  it('requires the gate token and rejects replay', async () => {
    const opened = openConfirm()
    expect(registry.resolveRemotely(opened.gate.id, 'not-the-token', { approved: true })).toEqual({
      ok: false,
      reason: 'bad_token',
    })

    const good = registry.resolveRemotely(opened.gate.id, opened.gateToken, { approved: true })
    expect(good.ok).toBe(true)

    // One-time: even the correct token is dead after resolution.
    expect(registry.resolveRemotely(opened.gate.id, opened.gateToken, { approved: false })).toEqual(
      { ok: false, reason: 'already_resolved' }
    )
  })

  it('resolves expired gates and answers expired to a late remote call', async () => {
    const opened = openConfirm(60_000)
    vi.advanceTimersByTime(61_000)

    const late = registry.resolveRemotely(opened.gate.id, opened.gateToken, { approved: true })
    expect(late).toEqual({ ok: false, reason: 'expired' })
    await expect(opened.wait()).resolves.toEqual({ expired: true })
  })

  it('lists pending gates and sweeps expired ones on the way', async () => {
    const kept = openConfirm(60_000)
    const dropped = registry.open({ kind: 'confirm', title: 'old', summary: 's', ttlMs: 1_000 })

    expect(registry.listPending().map((gate) => gate.id)).toEqual([kept.gate.id, dropped.gate.id])

    vi.advanceTimersByTime(2_000)
    expect(registry.listPending().map((gate) => gate.id)).toEqual([kept.gate.id])
    await expect(dropped.wait()).resolves.toEqual({ expired: true })
  })

  it('carries the input payload and approved indexes', async () => {
    const payload = { path: 'a.ts', summary: 's', hunks: [{ diff: '-x', removed: 1, added: 0 }] }
    const opened = registry.open({
      kind: 'input',
      title: 'review',
      summary: 's',
      payload,
      ttlMs: 60_000,
    })
    expect(opened.gate.kind).toBe('input')
    expect(opened.gate.payload).toEqual(payload)

    const settled: Array<GateOutcome | { expired: true }> = []
    const waiter = opened.wait().then((value) => {
      settled.push(value)
    })
    registry.resolveRemotely(opened.gate.id, opened.gateToken, {
      approved: true,
      approvedIndexes: [0],
    })
    await waiter
    expect(settled[0]).toEqual({ approved: true, approvedIndexes: [0], via: 'remote' })
  })

  it('notifies listeners on open and settle', async () => {
    const changes: number[] = []
    registry.onChange(() => changes.push(1))
    const opened = openConfirm()
    expect(changes).toEqual([1]) // gate_open
    registry.resolveRemotely(opened.gate.id, opened.gateToken, { approved: true })
    await opened.wait()
    expect(changes).toEqual([1, 1]) // gate_closed
  })
})
