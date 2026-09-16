import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { RemoteAuth } from '../electron/remote/auth'
import { RemoteDeviceStore } from '../electron/remote/devices'
import { startRemoteServer, type RunningRemoteServer } from '../electron/remote/server'

vi.mock('better-sqlite3', async () => {
  const { createSqliteShim } = await import('./helpers/sqliteShim')
  return createSqliteShim()
})

import Database from 'better-sqlite3'

const shellDir = mkdtempSync(path.join(tmpdir(), 'openpi-shell-'))
writeFileSync(path.join(shellDir, 'index.html'), '<!doctype html><title>OpenPi</title>')
writeFileSync(path.join(shellDir, 'app.js'), 'console.log(1)')
writeFileSync(path.join(shellDir, 'app.css'), 'body{}')

let db: Database.Database
let auth: RemoteAuth
let running: RunningRemoteServer
let base: string

beforeEach(async () => {
  db = new Database(':memory:')
  auth = new RemoteAuth(new RemoteDeviceStore(db))
  running = await startRemoteServer({
    auth,
    handlers: {},
    port: 0,
    host: '127.0.0.1',
    shellDir,
  })
  base = `http://127.0.0.1:${running.port}`
})

afterEach(async () => {
  await running.stop()
  db.close()
})

afterAll(() => {
  rmSync(shellDir, { recursive: true, force: true })
})

describe('pwa shell serving', () => {
  it('serves the fixed files with content types and a strict CSP', async () => {
    const html = await fetch(`${base}/`)
    expect(html.status).toBe(200)
    expect(html.headers.get('content-type')).toContain('text/html')
    expect(html.headers.get('content-security-policy')).toContain("default-src 'none'")
    expect(await html.text()).toContain('<title>OpenPi</title>')

    const js = await fetch(`${base}/app.js`)
    expect(js.status).toBe(200)
    expect(js.headers.get('content-type')).toContain('text/javascript')

    const css = await fetch(`${base}/app.css`)
    expect(css.status).toBe(200)
    expect(css.headers.get('content-type')).toContain('text/css')
  })

  it('answers 404 shell_not_built when the output directory is absent', async () => {
    await running.stop()
    running = await startRemoteServer({
      auth,
      handlers: {},
      port: 0,
      host: '127.0.0.1',
      shellDir: path.join(shellDir, 'missing'),
    })
    base = `http://127.0.0.1:${running.port}`
    const response = await fetch(`${base}/`)
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'shell_not_built' })
  })

  it('never serves a path outside the three fixed routes', async () => {
    for (const attempt of [
      '/index.html',
      '/..%2f..%2fetc%2fpasswd',
      '/app.js.map',
      '/api',
      '//',
      '/app.js/',
      '//app.js',
    ]) {
      const response = await fetch(`${base}${attempt}`)
      expect(response.status).toBe(501)
    }
  })
})
