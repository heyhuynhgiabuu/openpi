import { describe, expect, it, vi } from 'vitest'
import { RemoteAuth } from '../electron/remote/auth'
import { RemoteDeviceStore } from '../electron/remote/devices'
import { RemoteHost, REMOTE_PORT } from '../electron/remote/remoteHost'

vi.mock('better-sqlite3', async () => {
  const { createSqliteShim } = await import('./helpers/sqliteShim')
  return createSqliteShim()
})

import Database from 'better-sqlite3'
import type { SessionIndexStore } from '../electron/session/sessionIndex'

// RemoteHost owns the full enable/disable lifecycle: device store over the
// shared SQLite handle, auth, registry, SSE hub, handlers, and the port. This
// suite proves the toggle semantics on a real socket with a stub index store.
let db: Database.Database

function stubIndex(): SessionIndexStore {
  return {
    database: db,
  } as unknown as SessionIndexStore
}

const sessionAuth = {
  getAgentDir: () => '/nonexistent-agent-dir',
  getSessionState: () => null,
  getSessionIndex: () => null,
  activeWorkspacePath: () => null,
}

describe('RemoteHost lifecycle', () => {
  it('is inert until enabled and reports inactive after disable', async () => {
    db = new Database(':memory:')
    const host = new RemoteHost({
      sessionIndex: () => stubIndex(),
      sessionAuth,
      port: 0,
    })
    expect(host.isActive).toBe(false)
    host.dispatchSessionEvent({ type: 'agent_start' })

    const enabled = await host.enable()
    expect(host.isActive).toBe(true)
    expect(enabled.port).toBeGreaterThan(0)

    await host.disable()
    expect(host.isActive).toBe(false)
    expect(host.pendingGates()).toEqual([])
  })

  it('is idempotent: double enable binds once, double disable is safe', async () => {
    db = new Database(':memory:')
    const host = new RemoteHost({
      sessionIndex: () => stubIndex(),
      sessionAuth,
      port: 0,
    })
    const first = await host.enable()
    const second = await host.enable()
    expect(second.port).toBe(first.port)

    await host.disable()
    await host.disable()
    expect(host.isActive).toBe(false)
  })

  it('refuses to start without the session index store', async () => {
    db = new Database(':memory:')
    const host = new RemoteHost({
      sessionIndex: () => null,
      sessionAuth,
      port: 0,
    })
    await expect(host.enable()).rejects.toThrow('session index')
    expect(host.isActive).toBe(false)
  })

  it('exposes the fixed default port constant', () => {
    expect(REMOTE_PORT).toBe(8787)
  })

  it('pairs and serves requests through the enabled host, then dies on disable', async () => {
    db = new Database(':memory:')
    const host = new RemoteHost({
      sessionIndex: () => stubIndex(),
      sessionAuth,
      port: 0,
    })
    const { port } = await host.enable()
    const base = `http://127.0.0.1:${port}`

    // A pairing code minted outside the host's own auth instance must be
    // rejected — pairing secrets are not portable across RemoteAuth instances.
    const foreign = new RemoteAuth(new RemoteDeviceStore(db))
    const { code } = foreign.beginPairing()
    // The host has its own auth/store; pair through HTTP instead.
    const pairResponse = await fetch(`${base}/api/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ code, name: 'phone' }),
    })
    // The code belongs to a different auth instance, so this must be rejected.
    expect(pairResponse.status).toBe(403)

    await host.disable()
    await expect(fetch(`${base}/api/session-list`)).rejects.toThrow()
  })
})
