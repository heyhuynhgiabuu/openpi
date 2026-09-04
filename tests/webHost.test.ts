/**
 * @vitest-environment node
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
    getPath: (n: string) => os.tmpdir(),
    getVersion: () => '0.0.0',
    getName: () => 'OpenPi',
  },
}))

import { WebHost } from '../electron/services/webHost'

describe('webHost', () => {
  let tmp: string
  let host: WebHost
  let port: number | null
  let base: string

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-webhost-'))
    fs.writeFileSync(
      path.join(tmp, 'index.html'),
      '<html><title>OpenPi</title><body>hello</body></html>'
    )
    const assets = path.join(tmp, 'assets')
    fs.mkdirSync(assets)
    fs.writeFileSync(path.join(assets, 'index-abc.js'), 'console.log("hi")')
    host = new WebHost()
    port = await host.start({ host: '127.0.0.1', port: 0, rendererPath: tmp })
    if (!port) throw new Error('no port')
    base = `http://127.0.0.1:${port}`
  })

  afterAll(() => {
    host.stop()
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('serves health', async () => {
    const res = await fetch(`${base}/health`)
    expect(res.status).toBe(200)
    const j = (await res.json()) as { ok: boolean; exists: boolean }
    expect(j.ok).toBe(true)
    expect(j.exists).toBe(true)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('serves index.html at /', async () => {
    const res = await fetch(`${base}/`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(res.headers.get('etag')).toBeTruthy()
    const t = await res.text()
    expect(t).toContain('OpenPi')
  })

  it('fallback SPA for unknown path', async () => {
    const res = await fetch(`${base}/nonexistent-route`)
    expect(res.status).toBe(200)
    const t = await res.text()
    expect(t).toContain('OpenPi')
  })

  it('304 on If-None-Match', async () => {
    const res1 = await fetch(`${base}/`)
    const etag = res1.headers.get('etag')
    expect(etag).toBeTruthy()
    const res2 = await fetch(`${base}/`, { headers: { 'If-None-Match': etag ?? '' } })
    expect(res2.status).toBe(304)
  })

  it('serves assets with js mime', async () => {
    const res = await fetch(`${base}/assets/index-abc.js`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('javascript')
  })

  it('returns 404 for unknown ipc channel', async () => {
    const res = await fetch(`${base}/api/ipc/unknown:channel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(404)
  })

  it('returns 200 for known ipc channel', async () => {
    const res = await fetch(`${base}/api/ipc/openpi:get-app-info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j).toBeTruthy()
  })

  it('has security headers', async () => {
    const res = await fetch(`${base}/health`)
    expect(res.headers.get('x-frame-options')).toBe('DENY')
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('returns 503 when renderer missing', async () => {
    const h2 = new WebHost()
    const missing = path.join(os.tmpdir(), `missing-${Date.now()}`)
    const p = await h2.start({ host: '127.0.0.1', port: 0, rendererPath: missing })
    const b = `http://127.0.0.1:${p}`
    const res = await fetch(`${b}/`)
    expect(res.status).toBe(503)
    h2.stop()
  })
})
