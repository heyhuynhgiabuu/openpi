import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { RemoteAuth } from '../electron/remote/auth'
import { RemoteDeviceStore } from '../electron/remote/devices'
import { GateRegistry } from '../electron/remote/gates'
import { createRemoteHandlers } from '../electron/remote/handlers'
import { SseHub } from '../electron/remote/sse'
import { startRemoteServer, type RunningRemoteServer } from '../electron/remote/server'

vi.mock('better-sqlite3', async () => {
  const { createSqliteShim } = await import('./helpers/sqliteShim')
  return createSqliteShim()
})

import Database from 'better-sqlite3'

// An authorized agent dir with one real session file, so /api/session/:id
// exercises the authorizedSessionPath re-entry for real.
const agentDir = mkdtempSync(path.join(tmpdir(), 'openpi-remote-'))
const sessionDir = path.join(agentDir, 'sessions')
fs.mkdirSync(sessionDir, { recursive: true })
const sessionFile = path.join(sessionDir, 'abc12345.jsonl')
fs.writeFileSync(
  sessionFile,
  `${JSON.stringify({ type: 'session', version: 3, id: 'abc12345', cwd: '/tmp' })}\n` +
    `${JSON.stringify({ id: 'e1', parentId: null, type: 'message', timestamp: new Date().toISOString() })}\n`
)

let db: Database.Database
let auth: RemoteAuth
let registry: GateRegistry
let hub: SseHub
let running: RunningRemoteServer
let base: string
let token: string

beforeEach(async () => {
  db = new Database(':memory:')
  auth = new RemoteAuth(new RemoteDeviceStore(db))
  registry = new GateRegistry()
  hub = new SseHub(registry)
  const handlers = createRemoteHandlers({
    auth: {
      getAgentDir: () => agentDir,
      getSessionState: () => null,
      getSessionIndex: () => null,
      activeWorkspacePath: () => null,
    },
    sessionIndex: () => null,
    registry,
  })
  running = await startRemoteServer({ auth, handlers, port: 0, host: '127.0.0.1', hub })
  hub.start()
  base = `http://127.0.0.1:${running.port}`
  const { code } = auth.beginPairing()
  const pairResponse = await fetch(`${base}/api/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ code, name: 'phone' }),
  })
  const pairBody = (await pairResponse.json()) as { deviceToken: string }
  token = pairBody.deviceToken
})

afterEach(async () => {
  await running.stop()
  db.close()
})

afterAll(() => {
  rmSync(agentDir, { recursive: true, force: true })
})

function authHeader(): Record<string, string> {
  return { authorization: `Bearer ${token}` }
}

describe('read models over HTTP', () => {
  it('serves the session list', async () => {
    const response = await fetch(`${base}/api/session-list`, { headers: authHeader() })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ sessions: [] })
  })

  it('answers 404 for a session id outside the authorization, identically to unknown', async () => {
    const response = await fetch(`${base}/api/session/zzzz9999`, { headers: authHeader() })
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'not_found' })
  })

  it('serves the trajectory of an authorized session by file stem', async () => {
    const response = await fetch(`${base}/api/session/abc12345`, {
      headers: authHeader(),
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      sessionPath: string
      trajectory: { rows: unknown[] }
    }
    expect(body.sessionPath).toBe(sessionFile)
    expect(body.trajectory.rows).toHaveLength(1)
  })

  it('serves the review snapshot on turn-changes', async () => {
    const response = await fetch(`${base}/api/turn-changes`, { headers: authHeader() })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ changes: [] })
  })
})

describe('gate endpoints over HTTP', () => {
  it('runs the lifecycle: list, approve with clamped indexes, replay, wrong token', async () => {
    const opened = registry.open({
      kind: 'confirm',
      title: 'apply patch',
      summary: '2 hunks',
      payload: { hunks: [{ a: 1 }, { a: 2 }] },
      ttlMs: 60_000,
    })

    const list = await fetch(`${base}/api/gates`, { headers: authHeader() })
    const gates = (await list.json()) as {
      gates: Array<{ id: string; gateToken: string; title: string }>
    }
    expect(gates.gates).toHaveLength(1)
    expect(gates.gates[0]?.id).toBe(opened.gate.id)
    expect(gates.gates[0]?.title).toBe('apply patch')
    // The served one-time token must be the working credential.
    expect(gates.gates[0]?.gateToken).toBe(opened.gateToken)

    // Out-of-range indexes are dropped to an empty approval, per the desktop rule.
    const approve = await fetch(`${base}/api/gates/${opened.gate.id}/approve`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: base,
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ gateToken: opened.gateToken, approvedIndexes: [0, 99] }),
    })
    expect(approve.status).toBe(200)
    expect(await approve.json()).toEqual({ ok: true })
    // The promise the desktop modal awaits must carry the clamped indexes.
    const outcome = await opened.wait()
    expect(outcome).toEqual({ approved: true, approvedIndexes: [0], via: 'remote' })

    // Settled: a different token cannot even tell the gate existed.
    const replay = await fetch(`${base}/api/gates/${opened.gate.id}/deny`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: base,
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ gateToken: 'x'.repeat(24) }),
    })
    expect(replay.status).toBe(410)
    expect(await replay.json()).toEqual({ error: 'unknown_gate' })
  })

  it('answers 409 to the correct token on an already-settled gate', async () => {
    const opened = registry.open({ kind: 'confirm', title: 't', summary: 's', ttlMs: 60_000 })
    registry.settleLocally(opened.gate.id, { approved: true, via: 'desktop' })

    const response = await fetch(`${base}/api/gates/${opened.gate.id}/deny`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: base,
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ gateToken: opened.gateToken }),
    })
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'already_resolved' })
  })

  it('answers 410 expired to the correct token on a timed-out gate', async () => {
    const opened = registry.open({ kind: 'confirm', title: 't', summary: 's', ttlMs: 1 })
    await new Promise((resolve) => setTimeout(resolve, 10))

    const response = await fetch(`${base}/api/gates/${opened.gate.id}/deny`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: base,
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ gateToken: opened.gateToken }),
    })
    expect(response.status).toBe(410)
    expect(await response.json()).toEqual({ error: 'expired' })
  })

  it('answers 410 for a wrong gate token on a live gate', async () => {
    const opened = registry.open({ kind: 'confirm', title: 't', summary: 's', ttlMs: 60_000 })

    const response = await fetch(`${base}/api/gates/${opened.gate.id}/deny`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: base,
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ gateToken: 'wrong-wrong-wrong-wrong' }),
    })
    expect(response.status).toBe(410)
    expect(await response.json()).toEqual({ error: 'bad_token' })
  })
})

describe('sse stream', () => {
  it('streams gate_update and session events to a paired client', async () => {
    const response = await fetch(`${base}/api/events`, { headers: authHeader() })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')

    const reader = response.body?.getReader()
    const decoder = new TextDecoder()

    registry.open({ kind: 'confirm', title: 'gate', summary: 's', ttlMs: 60_000 })
    hub.onSessionEvent({ type: 'agent_start' })
    hub.onSessionEvent({ type: 'agent_end' })

    const deadline = Date.now() + 2000
    let text = ''
    while (Date.now() < deadline && !text.includes('agent_end')) {
      const chunk = await reader?.read()
      if (!chunk || chunk.done) break
      text += decoder.decode(chunk.value)
    }
    expect(text).toContain('event: gate_update')
    expect(text).toContain('event: agent_start')
    expect(text).toContain('event: agent_end')
    await reader?.cancel()
  })

  it('requires the bearer token like every other route', async () => {
    const response = await fetch(`${base}/api/events`)
    expect(response.status).toBe(401)
  })
})
