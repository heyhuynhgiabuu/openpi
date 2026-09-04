import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { WebSocketServer } from 'ws'
import { IPC } from '../../src/lib/ipc'
import { getAppInfo } from './shellEnv'
import {
  contentType,
  etagFor,
  readBody,
  resolveRendererPath,
  securityHeaders,
} from './webHostHelpers'

const allowedChannels = new Set<string>(Object.values(IPC as Record<string, string>))

// Toggle for tunnel new-session debug — set false to silence (easy revert)
const DEBUG_TUNNEL_NEW_SESSION = false

export interface WebHostOptions {
  port?: number
  host?: string
  tunnelOrigin?: string
  authUser?: string
  authPass?: string
  rendererPath?: string
}

export class WebHost {
  private server: http.Server | null = null
  private wsSet = new Set<unknown>()
  private wss: unknown = null
  private boundPort: number | null = null
  private rendererPath: string | null = null

  getPort(): number | null {
    return this.boundPort
  }

  isRunning(): boolean {
    return this.server !== null && this.boundPort !== null
  }

  broadcast(event: string, data: unknown): void {
    if (this.wsSet.size === 0) return
    const payload = JSON.stringify({ event, data })
    for (const c of [...this.wsSet]) {
      try {
        const ws = c as { readyState: number; send: (s: string) => void }
        // 1 === OPEN for ws lib
        if (ws.readyState === 1) ws.send(payload)
      } catch {
        this.wsSet.delete(c)
      }
    }
  }

  async start(opts: WebHostOptions = {}): Promise<number | null> {
    console.log('[webHost] start called', opts)
    if (this.server && this.boundPort !== null) return this.boundPort
    const host = opts.host ?? '127.0.0.1'
    const port = opts.port ?? 0
    const rendererPath = opts.rendererPath ?? resolveRendererPath()
    this.rendererPath = rendererPath

    const tunnelOrigin =
      opts.tunnelOrigin ??
      process.env.WEB_TUNNEL_ORIGIN ??
      process.env.TUNNEL_ORIGIN ??
      process.env.DASHBOARD_TUNNEL_ORIGIN ??
      ''
    const authUser =
      opts.authUser ??
      process.env.WEB_AUTH_USER ??
      process.env.DASHBOARD_AUTH_USER ??
      process.env.RELAY_AUTH_USER ??
      ''
    const authPass =
      opts.authPass ??
      process.env.WEB_AUTH_PASS ??
      process.env.DASHBOARD_AUTH_PASS ??
      process.env.RELAY_AUTH_PASS ??
      ''
    const authEnabled = Boolean(authUser && authPass)
    const expectedAuth = authEnabled
      ? `Basic ${Buffer.from(`${authUser}:${authPass}`).toString('base64')}`
      : ''

    if (tunnelOrigin && !authEnabled) {
      console.warn(
        '[webHost] WARNING: tunnel origin set without WEB_AUTH_USER/PASS — PII exposed to anyone with tunnel URL'
      )
    }

    const server = http.createServer(async (req, res) => {
      securityHeaders(res)
      const url = new URL(req.url ?? '/', `http://${host}`)
      const pathname = url.pathname

      if (authEnabled) {
        const h = req.headers.authorization ?? ''
        if (h !== expectedAuth) {
          if (DEBUG_TUNNEL_NEW_SESSION)
            console.warn(
              `[webHost] 401 unauthorized ${req.method} ${pathname} origin=${req.headers.origin ?? ''} hasAuth=${Boolean(h)}`
            )
          res.writeHead(401, {
            'WWW-Authenticate': 'Basic realm="openpi"',
            'Cache-Control': 'no-store',
          })
          res.end(JSON.stringify({ error: 'unauthorized' }))
          return
        }
      }
      const origin = req.headers.origin as string | undefined
      if (tunnelOrigin && origin) {
        const allowed =
          origin === tunnelOrigin ||
          origin === `http://${host}:${this.boundPort}` ||
          origin === `http://localhost:${this.boundPort}`
        if (!allowed) {
          res.writeHead(403, { 'Cache-Control': 'no-store' })
          res.end(JSON.stringify({ error: 'origin not allowed' }))
          return
        }
      }

      if (req.method === 'GET' && pathname === '/health') {
        const exists = fs.existsSync(rendererPath)
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        res.end(JSON.stringify({ ok: true, rendererPath, exists }))
        return
      }

      if (pathname.startsWith('/api/ipc/')) {
        if (req.method !== 'POST') {
          res.writeHead(405, { 'Cache-Control': 'no-store' })
          res.end(JSON.stringify({ error: 'method not allowed' }))
          return
        }
        const channel = decodeURIComponent(pathname.slice('/api/ipc/'.length))
        if (!allowedChannels.has(channel)) {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'unknown channel' }))
          return
        }
        let body: unknown = {}
        try {
          const raw = await readBody(req)
          if (raw) body = JSON.parse(raw)
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'bad json' }))
          return
        }
        // minimal Zod: ensure body is object-ish; channels validate in their own handlers
        // but we at least reject arrays as top-level for object channels
        void body
        if (DEBUG_TUNNEL_NEW_SESSION)
          console.log(`[webHost] IPC ${channel}`, JSON.stringify(body).slice(0, 500))
        try {
          const result = await this.dispatchIpc(channel, body)
          if (DEBUG_TUNNEL_NEW_SESSION)
            console.log(`[webHost] IPC ${channel} ok`, JSON.stringify(result)?.slice(0, 500))
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
          res.end(JSON.stringify(result))
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          console.error(`[webHost] IPC ${channel} failed`, msg)
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: msg }))
        }
        return
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'Cache-Control': 'no-store' })
        res.end(JSON.stringify({ error: 'method not allowed' }))
        return
      }

      if (!fs.existsSync(rendererPath)) {
        res.writeHead(503, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
        })
        res.end('Renderer not built — run npm run build (missing out/renderer)')
        return
      }

      const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
      const filePath = path.normalize(path.join(rendererPath, rel))
      if (filePath !== rendererPath && !filePath.startsWith(rendererPath + path.sep)) {
        res.writeHead(403, { 'Cache-Control': 'no-store' })
        res.end(JSON.stringify({ error: 'forbidden' }))
        return
      }

      const tryServe = (fp: string, isFallback: boolean): boolean => {
        if (!fs.existsSync(fp)) return false
        const stat = fs.statSync(fp)
        if (stat.isDirectory()) return false
        const buf = fs.readFileSync(fp)
        const tag = etagFor(buf)
        if (req.headers['if-none-match'] === tag) {
          res.writeHead(304, { ETag: tag })
          res.end()
          return true
        }
        res.writeHead(200, {
          'Content-Type': contentType(fp),
          'Cache-Control': 'no-cache',
          ETag: tag,
          'Content-Security-Policy':
            "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: localfile:; font-src 'self' data:; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:* https://*.share.zrok.io wss://*.share.zrok.io https://*.shares.zrok.io wss://*.shares.zrok.io;",
        })
        if (req.method === 'HEAD') res.end()
        else res.end(buf)
        void isFallback
        return true
      }

      if (tryServe(filePath, false)) return
      const indexFallback = path.join(rendererPath, 'index.html')
      if (tryServe(indexFallback, true)) return
      res.writeHead(404, { 'Cache-Control': 'no-store' })
      res.end('not found')
    })

    // WS upgrade for /api/events — static import, always available (ws@8)
    try {
      const wss: InstanceType<typeof WebSocketServer> = new WebSocketServer({ noServer: true })
      wss.on(
        'connection',
        (
          ws: InstanceType<typeof WebSocketServer> extends {
            on: (e: string, cb: (ws: infer W) => void) => void
          }
            ? W
            : never
        ) => {
          this.wsSet.add(ws)
          ;(ws as unknown as { on: (e: string, fn: () => void) => void }).on('close', () =>
            this.wsSet.delete(ws)
          )
        }
      )
      // also handle 'error' to avoid unhandled
      wss.on('error', () => {})
      server.on('upgrade', (req, socket, head) => {
        const rawUrl = req.url ?? '/'
        // pathname without query, tolerant to trailing slash
        const pathname = rawUrl.split('?')[0].split('#')[0]
        if (pathname !== '/api/events' && pathname !== '/api/events/') {
          socket.destroy()
          return
        }
        if (authEnabled) {
          const h = (req.headers.authorization ?? '') as string
          if (h !== expectedAuth) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
            socket.destroy()
            return
          }
        }
        wss.handleUpgrade(req as never, socket as never, head as never, (ws) => {
          wss.emit('connection', ws as never)
        })
      })
      this.wss = wss
    } catch (e) {
      console.warn('[webHost] WS init failed', e)
    }

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, host, () => {
        const addr = server.address()
        const bound = addr && typeof addr === 'object' ? (addr as { port: number }).port : port
        this.boundPort = bound
        console.log(`WebHost on http://${host}:${bound}`)
        resolve()
      })
    })

    this.server = server
    return this.boundPort
  }

  private async dispatchIpc(channel: string, payload: unknown): Promise<unknown> {
    if (channel === IPC.GET_APP_INFO) return getAppInfo()
    if (channel === IPC.GET_PREF || channel === IPC.SET_PREF) return null
    // Remote browser needs real workspace/session data. Import sessionHost lazily to avoid cycle.
    try {
      const { getSessionIndexStore, getSessionState, startSession, activeWorkspacePath } =
        await import('../session/sessionHost')
      const si = getSessionIndexStore()
      if (channel === IPC.GET_WORKSPACES) {
        return si?.listWorkspaces() ?? []
      }
      if (channel === IPC.GET_SESSIONS) {
        const opts = (payload ?? {}) as { workspacePath?: string }
        const workspacePath = opts.workspacePath ?? activeWorkspacePath() ?? null
        if (!workspacePath) return []
        const activeSessionPath = getSessionState()?.sessionFile ?? null
        if (si) await si.refreshSessions(activeSessionPath, workspacePath)
        return si?.listSessions(opts as never, activeSessionPath, workspacePath) ?? []
      }
      if (channel === IPC.GET_SESSION_TREE || channel === IPC.GET_SESSION_MESSAGES) {
        // delegate via si if available; otherwise fallback
        const p = payload as { path?: string }
        if (!p?.path) return null
        if (channel === IPC.GET_SESSION_TREE) return si?.getSessionTree(p.path) ?? null
        return (
          si?.getSessionMessages(p.path, p as never) ?? {
            messages: [],
            hasMoreBefore: false,
            nextBeforeEntryId: null,
            limit: 0,
          }
        )
      }
      if (channel === IPC.PICK_WORKSPACE) {
        const maybePath = (payload as { path?: string } | null)?.path?.trim()
        if (maybePath) {
          const path = await import('node:path')
          const fs = await import('node:fs')
          const resolved = path.default.resolve(maybePath)
          try {
            const stat = fs.default.statSync(resolved)
            if (!stat.isDirectory()) throw new Error(`Not a directory: ${resolved}`)
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            if (msg.includes('ENOENT')) {
              throw new Error(`Directory does not exist: ${resolved}`)
            }
            throw e instanceof Error ? e : new Error(String(e))
          }
          try {
            await startSession(resolved)
            return { cancelled: false, path: resolved }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            // Propagate as 500 so webBridge retry dialog sees it
            throw new Error(msg)
          }
        }
        // Remote browser has no native directory picker — return known workspaces so UI can show prompt
        const wss = si?.listWorkspaces() ?? []
        if (wss.length)
          return { cancelled: true, workspaces: wss, hint: 'pick from workspaces or send {path}' }
        return { cancelled: true }
      }
      if (channel === IPC.NEW_SESSION) {
        const p = payload as { cwd?: string; mode?: string; baseBranch?: string }
        if (DEBUG_TUNNEL_NEW_SESSION)
          console.log(
            '[webHost:new-session] payload',
            p,
            'active',
            activeWorkspacePath(),
            'state',
            getSessionState()?.cwd
          )
        const si2 = si
        const cwd =
          p?.cwd ??
          activeWorkspacePath() ??
          getSessionState()?.cwd ??
          si2?.getLastWorkspace() ??
          null
        if (DEBUG_TUNNEL_NEW_SESSION) console.log('[webHost:new-session] resolved cwd', cwd)
        if (!cwd) {
          console.warn('[webHost:new-session] no workspace — abort')
          throw new Error('no workspace')
        }
        // Expand ~ and canonicalize like desktop authorizedWorkspacePath
        let resolvedCwd = cwd
        try {
          const os = await import('node:os')
          const path = await import('node:path')
          const fs = await import('node:fs')
          if (resolvedCwd.startsWith('~/'))
            resolvedCwd = path.default.join(os.default.homedir(), resolvedCwd.slice(2))
          else if (resolvedCwd === '~') resolvedCwd = os.default.homedir()
          try {
            resolvedCwd = fs.default.realpathSync.native(resolvedCwd)
          } catch {
            resolvedCwd = path.default.resolve(resolvedCwd)
          }
          if (DEBUG_TUNNEL_NEW_SESSION)
            console.log('[webHost:new-session] canonicalized', resolvedCwd)
        } catch {}
        try {
          await startSession(resolvedCwd, p?.mode ? { worktreePath: undefined } : undefined)
          if (DEBUG_TUNNEL_NEW_SESSION) console.log('[webHost:new-session] success', resolvedCwd)
          return { ok: true }
        } catch (err) {
          console.error('[webHost:new-session] failed', err)
          throw err
        }
      }
      if (channel === IPC.OPEN_SESSION) {
        const p = payload as { path?: string }
        if (!p?.path) throw new Error('missing path')
        const state = getSessionState()
        const cwd = si?.getSessionWorkspace(p.path) ?? state?.cwd
        if (!cwd) throw new Error('no cwd for session')
        await startSession(cwd, { sessionFile: p.path })
        return { ok: true }
      }
      if (channel === IPC.GET_SESSION_STATS) {
        const { getPiSidecarHost, createRequestId } = await import('../session/sessionHost')
        const pi = getPiSidecarHost()
        if (!pi || !getSessionState())
          return {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            cost: 0,
            contextUsagePercent: null,
            contextTokens: null,
            contextWindow: null,
            sessionFile: null,
            sessionId: null,
            isStreaming: false,
          }
        const res = (await pi.request({
          type: 'get_stats',
          requestId: createRequestId(),
        } as never)) as { stats: unknown }
        return (res as { stats: unknown }).stats
      }
      if (
        channel === IPC.SESSION_PROMPT ||
        channel === IPC.SESSION_STEER ||
        channel === IPC.SESSION_FOLLOW_UP
      ) {
        const { ensureActiveSession } = await import('../session/sessionHost')
        const { getPiSidecarHost } = await import('../session/sessionHost')
        const pi = getPiSidecarHost()
        if (!(await ensureActiveSession())) throw new Error('no active session')
        const { text, contextPrefix } = payload as { text?: string; contextPrefix?: string }
        if (!text) return { ok: true }
        const type =
          channel === IPC.SESSION_PROMPT
            ? 'prompt'
            : channel === IPC.SESSION_STEER
              ? 'steer'
              : 'follow_up'
        pi?.send({ type, text, contextPrefix } as never)
        return { ok: true }
      }
      if (channel === IPC.SESSION_ABORT) {
        const { getPiSidecarHost } = await import('../session/sessionHost')
        getPiSidecarHost()?.send({ type: 'abort' } as never)
        return { ok: true }
      }
    } catch (err) {
      // fallback to stub if sessionHost not ready
      void err
    }
    // default: acknowledged so UI doesn't block; real Electron IPC remains primary
    return { ok: true, channel }
  }

  stop(): void {
    for (const c of [...this.wsSet]) {
      try {
        const ws = c as { close: () => void }
        ws.close()
      } catch {
        // ignore
      }
    }
    this.wsSet.clear()
    if (this.server) {
      try {
        this.server.close()
      } catch {
        // ignore
      }
      this.server = null
    }
    this.boundPort = null
    this.wss = null
  }
}

export const webHost = new WebHost()
