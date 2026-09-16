/**
 * remoteExtensionUiBridge.test.ts — the registry hop for extension UI
 * prompts: intercept rules, renderer-first vs remote-first settlement, the
 * relayed response shapes per method, and the shipped path over HTTP.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExtensionUiRequest, ExtensionUiResponse } from '../src/lib/extensionUiTypes'
import { GateRegistry, type OpenedGate } from '../electron/remote/gates'
import {
  clearPending,
  interceptExtensionUi,
  pendingIds,
  resolveFromRenderer,
  type ExtensionUiRelay,
} from '../electron/remote/extensionUiBridge'

vi.mock('better-sqlite3', async () => {
  const { createSqliteShim } = await import('./helpers/sqliteShim')
  return createSqliteShim()
})

import Database from 'better-sqlite3'
import { RemoteAuth } from '../electron/remote/auth'
import { RemoteDeviceStore } from '../electron/remote/devices'
import { RemoteHost } from '../electron/remote/remoteHost'
import type { SessionIndexStore } from '../electron/session/sessionIndex'

const sessionAuth = {
  getAgentDir: () => '/nonexistent-agent-dir',
  getSessionState: () => null,
  getSessionIndex: () => null,
  activeWorkspacePath: () => null,
}

let db: Database.Database

const confirmRequest: ExtensionUiRequest = {
  id: 'r1',
  method: 'confirm',
  title: 'Allow write?',
  message: 'outside.covers overwrite',
}

const preapplyRequest: ExtensionUiRequest = {
  id: 'r2',
  method: 'preapply_review',
  title: 'Review: a.ts',
  review: {
    path: 'a.ts',
    summary: '2 hunks',
    hunks: [
      { diff: '-a\n+b', removed: 1, added: 1 },
      { diff: '+b2\n+b3', removed: 0, added: 2 },
    ],
  },
}

const markedInputRequest: ExtensionUiRequest = {
  id: 'r3',
  method: 'input',
  title: 'Review: b.ts',
  placeholder:
    'openpi-preapply-review:' +
    JSON.stringify({
      path: 'b.ts',
      summary: '1 hunk',
      hunks: [{ diff: '-old\n+new', removed: 2, added: 1 }],
    }),
}

function harness(enabled: boolean) {
  const registry = new GateRegistry()
  const relays: ExtensionUiResponse[] = []
  const opened: OpenedGate[] = []
  const intercept = (request: ExtensionUiRequest): boolean =>
    interceptExtensionUi({
      request,
      openGate: (gate) => {
        if (!enabled) return null
        const openedGate = registry.open({ kind: 'confirm', ...gate })
        opened.push(openedGate)
        return openedGate
      },
      settle: (gate, approved) =>
        registry.settleLocally(gate.gate.id, { approved, via: 'desktop' }),
      relay: (response) => relays.push(response),
    })
  return { registry, relays, opened, intercept }
}

afterEach(() => {
  clearPending()
})

describe('intercept rules', () => {
  it('bridges confirm, preapply_review, and marked inputs; passes the rest', () => {
    const { intercept } = harness(true)
    expect(intercept(confirmRequest)).toBe(true)
    expect(intercept(preapplyRequest)).toBe(true)
    expect(intercept(markedInputRequest)).toBe(true)
    expect(intercept({ id: 'r4', method: 'input', title: 'plain' })).toBe(false)
    expect(intercept({ id: 'r5', method: 'select', title: 'pick', options: ['a'] })).toBe(false)
    expect(pendingIds()).toEqual(['r1', 'r2', 'r3'])
  })

  it('does not bridge when remote is off', () => {
    const { intercept, relays } = harness(false)
    expect(intercept(confirmRequest)).toBe(false)
    // Renderer answers: plain relay, nothing to settle.
    expect(resolveFromRenderer({ id: 'r1', confirmed: true })).toBe('relay')
    expect(relays).toEqual([])
  })
})

describe('settlement races', () => {
  it('renderer first: relay verbatim, gate tombstoned (remote replay → 409)', () => {
    const { registry, intercept } = harness(true)
    intercept(confirmRequest)
    expect(resolveFromRenderer({ id: 'r1', confirmed: true })).toBe('relay')
    expect(registry.resolveRemotely('r1', 'x'.repeat(24), { approved: true })).toEqual({
      ok: false,
      reason: 'unknown_gate',
    })
  })

  it('remote first: relay carries the remote decision; stale renderer answer drops', async () => {
    const { registry, opened, relays, intercept } = harness(true)
    intercept(confirmRequest)
    const gate = opened[0]!

    expect(registry.resolveRemotely(gate.gate.id, gate.gateToken, { approved: true })).toEqual({
      ok: true,
      outcome: { approved: true, via: 'remote' },
    })
    await vi.waitFor(() => expect(relays).toEqual([{ id: 'r1', confirmed: true }]))
    // The stale desktop answer must drop, not reach the sidecar twice.
    expect(resolveFromRenderer({ id: 'r1', confirmed: true })).toBe('drop')
    expect(relays).toHaveLength(1)
  })

  it('desktop first: remote replay answers already_resolved (409 upstream)', () => {
    const { registry, opened, intercept } = harness(true)
    intercept(confirmRequest)
    const gate = opened[0]!

    expect(resolveFromRenderer({ id: 'r1', confirmed: false })).toBe('relay')
    expect(registry.resolveRemotely(gate.gate.id, gate.gateToken, { approved: true })).toEqual({
      ok: false,
      reason: 'already_resolved',
    })
  })
})

describe('shipped path over HTTP', () => {
  let host: RemoteHost
  let base = ''
  let token = ''

  beforeEach(async () => {
    db = new Database(':memory:')
    host = new RemoteHost({
      sessionIndex: () => ({ database: db }) as SessionIndexStore,
      sessionAuth,
      port: 0,
    })
    const { port } = await host.enable()
    base = `http://127.0.0.1:${port}`
    const { code } = host.beginPairing()
    const pairResponse = await fetch(`${base}/api/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ code, name: 'phone' }),
    })
    token = ((await pairResponse.json()) as { deviceToken: string }).deviceToken
  })

  afterEach(async () => {
    await host.disable()
    db.close()
  })

  it('remote approval relays the extension response with all hunk indexes', async () => {
    const relays: ExtensionUiResponse[] = []
    const bridged = host.bridgeExtensionUi(preapplyRequest, (response) => {
      relays.push(response)
    })
    expect(bridged).toBe(true)

    const list = await fetch(`${base}/api/gates`, {
      headers: { authorization: `Bearer ${token}` },
    })
    const gates = (await list.json()) as {
      gates: Array<{ id: string; gateToken: string; payload: { hunks: unknown[] } }>
    }
    const served = gates.gates[0]
    expect(served?.payload.hunks).toHaveLength(2)

    // The phone approves all hunks (GateCards sends the full index list).
    const approve = await fetch(`${base}/api/gates/${served?.id}/approve`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: base,
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        gateToken: served?.gateToken,
        approvedIndexes: [0, 1],
      }),
    })
    expect(approve.status).toBe(200)
    await vi.waitFor(() => expect(relays).toHaveLength(1))
    expect(relays[0]).toEqual({
      id: 'r2',
      approved: [0, 1],
      remember: false,
    })

    // The stale desktop answer is dropped, not relayed a second time.
    expect(resolveFromRenderer({ id: 'r2', approved: [1], remember: true })).toBe('drop')
    expect(relays).toHaveLength(1)
  })

  it('marked input approve relays the parsed-answer JSON string', async () => {
    const relays: ExtensionUiResponse[] = []
    expect(
      host.bridgeExtensionUi(markedInputRequest, (response) => {
        relays.push(response)
      })
    ).toBe(true)

    const list = await fetch(`${base}/api/gates`, {
      headers: { authorization: `Bearer ${token}` },
    })
    const gates = (await list.json()) as { gates: Array<{ id: string; gateToken: string }> }
    await fetch(`${base}/api/gates/${gates.gates[0]?.id}/approve`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: base,
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ gateToken: gates.gates[0]?.gateToken, approvedIndexes: [0] }),
    })
    await vi.waitFor(() => expect(relays).toHaveLength(1))
    expect(relays[0]?.value).toBe(JSON.stringify({ approved: [0], remember: false }))
  })

  it('confirm deny relays confirmed:false; unbridged prompts never relay', async () => {
    const relays: ExtensionUiResponse[] = []
    expect(host.bridgeExtensionUi(confirmRequest, (r) => relays.push(r))).toBe(true)
    const list = await fetch(`${base}/api/gates`, {
      headers: { authorization: `Bearer ${token}` },
    })
    const gates = (await list.json()) as { gates: Array<{ id: string; gateToken: string }> }
    await fetch(`${base}/api/gates/${gates.gates[0]?.id}/deny`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: base,
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ gateToken: gates.gates[0]?.gateToken }),
    })
    await vi.waitFor(() => expect(relays).toEqual([{ id: 'r1', confirmed: false }]))

    // Remote off (host disabled): nothing bridges, nothing relays.
    await host.disable()
    expect(host.bridgeExtensionUi(confirmRequest, (r) => relays.push(r))).toBe(false)
    expect(relays).toHaveLength(1)
  })
})
