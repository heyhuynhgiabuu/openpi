import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RemoteHost } from '../electron/remote/remoteHost'
import { GateRegistry } from '../electron/remote/gates'
import { runGatedConfirm } from '../electron/remote/gateBridge'

vi.mock('better-sqlite3', async () => {
  const { createSqliteShim } = await import('./helpers/sqliteShim')
  return createSqliteShim()
})

import Database from 'better-sqlite3'
import type { SessionIndexStore } from '../electron/session/sessionIndex'

const sessionAuth = {
  getAgentDir: () => '/nonexistent-agent-dir',
  getSessionState: () => null,
  getSessionIndex: () => null,
  activeWorkspacePath: () => null,
}

let db: Database.Database

function stubIndex(): SessionIndexStore {
  return { database: db } as unknown as SessionIndexStore
}

function deferred(): { promise: Promise<boolean>; resolve: (v: boolean) => void } {
  let resolve = (_v: boolean): void => {}
  const promise = new Promise<boolean>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('runGatedConfirm against a bare registry', () => {
  it('lets the remote answer win while the dialog is still open', async () => {
    const registry = new GateRegistry()
    const gate = registry.open({ kind: 'confirm', title: 't', summary: 's', ttlMs: 60_000 })
    const dialog = deferred()
    const pending = runGatedConfirm({
      gate,
      desktopConfirm: dialog.promise,
      settleDesktop: (approved) =>
        registry.settleLocally(gate.gate.id, { approved, via: 'desktop' }),
    })

    // The exact call the HTTP gate-approve handler makes.
    expect(registry.resolveRemotely(gate.gate.id, gate.gateToken, { approved: true })).toEqual({
      ok: true,
      outcome: { approved: true, via: 'remote' },
    })
    await expect(pending).resolves.toBe(true)

    // The dialog's eventual answer is inert.
    dialog.resolve(false)
    expect(await Promise.race([dialog.promise, Promise.resolve('pending')])).toBe(false)
  })

  it('lets the desktop answer win and tombstones the gate', async () => {
    const registry = new GateRegistry()
    const gate = registry.open({ kind: 'confirm', title: 't', summary: 's', ttlMs: 60_000 })
    const dialog = deferred()
    const pending = runGatedConfirm({
      gate,
      desktopConfirm: dialog.promise,
      settleDesktop: (approved) =>
        registry.settleLocally(gate.gate.id, { approved, via: 'desktop' }),
    })

    dialog.resolve(false)
    await expect(pending).resolves.toBe(false)
    // A late remote answer hits the tombstone: already_resolved (409).
    expect(registry.resolveRemotely(gate.gate.id, gate.gateToken, { approved: true })).toEqual({
      ok: false,
      reason: 'already_resolved',
    })
  })

  it('counts remote expiry as denial while the dialog stays open', async () => {
    const registry = new GateRegistry()
    const gate = registry.open({ kind: 'confirm', title: 't', summary: 's', ttlMs: 1 })
    const dialog = deferred()
    const pending = runGatedConfirm({
      gate,
      desktopConfirm: dialog.promise,
      settleDesktop: () => true,
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    await expect(pending).resolves.toBe(false)
    dialog.resolve(true)
  })
})

describe('bridged confirm over real HTTP (shipped path)', () => {
  let host: RemoteHost
  let base = ''
  let token = ''

  beforeEach(async () => {
    db = new Database(':memory:')
    host = new RemoteHost({ sessionIndex: () => stubIndex(), sessionAuth, port: 0 })
    const { port } = await host.enable()
    base = `http://127.0.0.1:${port}`
    const { code } = host.beginPairing()
    const pairResponse = await fetch(`${base}/api/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ code, name: 'phone' }),
    })
    expect(pairResponse.status).toBe(200)
    token = ((await pairResponse.json()) as { deviceToken: string }).deviceToken
  })

  afterEach(async () => {
    await host.disable()
    db.close()
  })

  it('pair → served gate token → HTTP approval settles the desktop confirm', async () => {
    const dialog = deferred()
    const gate = host.openBridgeGate({
      title: 'Confirm high-risk command',
      summary: 'rm -rf style mutation',
      ttlMs: 60_000,
    })
    const pending = runGatedConfirm({
      gate: gate!,
      desktopConfirm: dialog.promise,
      settleDesktop: (approved) => host.settleBridgeGate(gate!.gate.id, approved),
    })

    const list = await fetch(`${base}/api/gates`, {
      headers: { authorization: `Bearer ${token}` },
    })
    const gates = (await list.json()) as { gates: Array<{ id: string; gateToken: string }> }
    expect(gates.gates).toHaveLength(1)

    const approve = await fetch(`${base}/api/gates/${gates.gates[0]?.id}/approve`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: base,
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ gateToken: gates.gates[0]?.gateToken }),
    })
    expect(approve.status).toBe(200)
    await expect(pending).resolves.toBe(true)

    // Replay is a conflict, not a second resolution.
    const replay = await fetch(`${base}/api/gates/${gates.gates[0]?.id}/deny`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: base,
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ gateToken: gates.gates[0]?.gateToken }),
    })
    expect(replay.status).toBe(409)
  })

  it('lets the desktop deny first; the gate vanishes for the phone', async () => {
    const dialog = deferred()
    const gate = host.openBridgeGate({ title: 't', summary: 's', ttlMs: 60_000 })
    const pending = runGatedConfirm({
      gate: gate!,
      desktopConfirm: dialog.promise,
      settleDesktop: (approved) => host.settleBridgeGate(gate!.gate.id, approved),
    })

    dialog.resolve(false)
    await expect(pending).resolves.toBe(false)
    expect(host.pendingGates()).toHaveLength(0)
    expect(gate).not.toBeNull()
  })
})
