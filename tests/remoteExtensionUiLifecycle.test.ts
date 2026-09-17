import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExtensionUiRequest, ExtensionUiResponse } from '../src/lib/extensionUiTypes'
import { GateRegistry, type OpenedGate } from '../electron/remote/gates'
import {
  clearPending,
  interceptExtensionUi,
  pendingIds,
  resolveFromRenderer,
  withdrawFromPromptEnd,
} from '../electron/remote/extensionUiBridge'

vi.mock('better-sqlite3', async () => {
  const { createSqliteShim } = await import('./helpers/sqliteShim')
  return createSqliteShim()
})

import Database from 'better-sqlite3'
import { RemoteHost } from '../electron/remote/remoteHost'
import type { SessionIndexStore } from '../electron/session/sessionIndex'

const sessionAuth = {
  getAgentDir: () => '/nonexistent-agent-dir',
  getSessionState: () => null,
  getSessionIndex: () => null,
  activeWorkspacePath: () => null,
}

const confirmRequest: ExtensionUiRequest = {
  id: 'lifecycle-1',
  method: 'confirm',
  title: 'Allow write?',
  message: 'outside.covers overwrite',
}

function bridgeHarness() {
  const registry = new GateRegistry()
  const relays: ExtensionUiResponse[] = []
  const opened: OpenedGate[] = []
  const bridged = interceptExtensionUi({
    request: confirmRequest,
    openGate: (gate) => {
      const openedGate = registry.open({ kind: 'confirm', ...gate })
      opened.push(openedGate)
      return openedGate
    },
    settle: (gate, approved) => registry.settleLocally(gate.gate.id, { approved, via: 'desktop' }),
    withdraw: (gate) => registry.withdraw(gate.gate.id),
    relay: (response) => relays.push(response),
  })
  return { bridged, registry, relays, opened }
}

afterEach(() => {
  clearPending()
})

describe('extension prompt lifecycle', () => {
  it('withdraws a prompt-ended gate and rejects stale answers', async () => {
    const { bridged, registry, opened, relays } = bridgeHarness()
    expect(bridged).toBe(true)
    const gate = opened[0]
    if (!gate) throw new Error('expected a bridged gate')

    expect(withdrawFromPromptEnd(confirmRequest.id)).toBe(true)
    expect(pendingIds()).toEqual([])
    expect(relays).toEqual([{ id: confirmRequest.id, cancelled: true }])
    await expect(gate.wait()).resolves.toEqual({ expired: true })
    expect(registry.resolveRemotely(gate.gate.id, gate.gateToken, { approved: true })).toEqual({
      ok: false,
      reason: 'already_resolved',
    })
    expect(resolveFromRenderer({ id: confirmRequest.id, confirmed: true })).toBe('drop')
    expect(relays).toHaveLength(1)
  })

  it('does nothing for an unknown prompt id', () => {
    const { bridged, registry } = bridgeHarness()
    expect(bridged).toBe(true)
    expect(withdrawFromPromptEnd('other-id')).toBe(false)
    expect(pendingIds()).toEqual([confirmRequest.id])
    expect(registry.listPending()).toHaveLength(1)
  })
})

describe('shipped prompt lifecycle', () => {
  let db: Database.Database
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

  it('withdraws the cached gate and returns 409 to a late approval', async () => {
    const relays: ExtensionUiResponse[] = []
    expect(host.bridgeExtensionUi(confirmRequest, (response) => relays.push(response))).toBe(true)

    const listBeforeEnd = await fetch(`${base}/api/gates`, {
      headers: { authorization: `Bearer ${token}` },
    })
    const served = (await listBeforeEnd.json()) as {
      gates: Array<{ id: string; gateToken: string }>
    }
    const gate = served.gates[0]
    if (!gate) throw new Error('expected a bridged gate')

    host.dispatchSessionEvent({ type: 'ui_prompt_end', id: confirmRequest.id })
    await vi.waitFor(() => expect(relays).toEqual([{ id: confirmRequest.id, cancelled: true }]))

    const list = await fetch(`${base}/api/gates`, {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(((await list.json()) as { gates: unknown[] }).gates).toEqual([])

    const late = await fetch(`${base}/api/gates/${gate.id}/approve`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: base,
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ gateToken: gate.gateToken }),
    })
    expect(late.status).toBe(409)
  })

  it('withdraws a prompt after remote is disabled', async () => {
    const relays: ExtensionUiResponse[] = []
    expect(host.bridgeExtensionUi(confirmRequest, (response) => relays.push(response))).toBe(true)

    await host.disable()
    host.dispatchSessionEvent({ type: 'ui_prompt_end', id: confirmRequest.id })
    await vi.waitFor(() => expect(relays).toEqual([{ id: confirmRequest.id, cancelled: true }]))
  })
})
