/**
 * Dashboard server host — Electron main process only.
 * Spawns the vendored dashboard server (electron/vendor/dashboard-server.cjs)
 * on a loopback dynamic port for the remote browser dashboard. Renderer never
 * talks to the raw server directly; it only reads tunnel/dashboard status over IPC.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { currentDir } from './shellEnv'

/** Matches the `Dashboard on http://HOST:PORT …` banner the server prints on listen. */
const DASHBOARD_URL_RE = /(?:Dashboard|Relay-pi-dashboard) on http:\/\/[^:]*:(\d+)/

/**
 * Locates the vendored dashboard server executable.
 * dev:  electron/vendor/dashboard-server.cjs
 * prod: <resourcesPath>/vendor/dashboard-server.cjs (extraResources "to": "vendor")
 */
function dashboardServerExecutable(): string {
  const file = 'dashboard-server.cjs'
  if (app.isPackaged) return path.join(process.resourcesPath, 'vendor', file)
  // dev: app.getAppPath() is repo root, works both before and after vite bundle (out/main vs electron/services)
  const devPath = path.join(app.getAppPath(), 'electron', 'vendor', file)
  if (fs.existsSync(devPath)) return devPath
  return path.resolve(currentDir, '../vendor', file)
}

export interface DashboardServerOptions {
  /** Port to bind; `0` lets the OS pick a free one (no TOCTOU race). Default 0. */
  port?: number
  /** Bind host, loopback only. Default 127.0.0.1. */
  host?: string
  /** External tunnel URL for origin allow-listing (mutants reject it in the server). */
  tunnelOrigin?: string
  authUser?: string
  authPass?: string
  enableControl?: boolean
  enableDispatch?: boolean
  /** path.join(BOARD_ROOT, 'views') static views; override only if ~/.pi/agent is non-default */
  agentBoardRoot?: string
  /** live session transcripts root; override only if ~/.pi/agent is non-default */
  sessionRoot?: string
  /** pi-agent-board node_modules dir for detached dispatch */
  dispatchBoardDir?: string
  piCommand?: string
  piArgs?: string[]
}

type SpawnedChild = ReturnType<typeof spawn>

export class DashboardServerHost {
  private child: SpawnedChild | null = null
  private boundPort: number | null = null
  private startPromise: Promise<number | null> | null = null

  /** Actual bound port once running; null when stopped or not yet bound. */
  getPort(): number | null {
    return this.boundPort
  }

  /** True while the spawned dashboard process is alive. */
  isRunning(): boolean {
    return this.child !== null && this.child.exitCode === null
  }

  /**
   * Spawns dashboard-server.cjs and resolves once it reports the bound port.
   * Uses DASHBOARD_PORT=0 so the kernel picks a free port atomically — we never
   * probe-and-close a socket first (no TOCTOU race between probe and spawn).
   */
  start(opts: DashboardServerOptions = {}): Promise<number | null> {
    if (this.child) return this.startPromise ?? Promise.resolve(this.boundPort)

    const serverPath = dashboardServerExecutable()
    const vendorDir = path.dirname(serverPath)

    const env: NodeJS.ProcessEnv = { ...process.env }
    // Electron main's process.execPath is the Electron binary; run it as plain node.
    env.ELECTRON_RUN_AS_NODE = '1'
    const portStr = String(opts.port ?? 0)
    const hostStr = opts.host ?? '127.0.0.1'
    // Primary DASHBOARD_* vars, with RELAY_* aliases for vendored server backward compat.
    env.DASHBOARD_PORT = portStr
    env.RELAY_PORT = portStr
    env.DASHBOARD_HOST = hostStr
    env.RELAY_HOST = hostStr
    env.DASHBOARD_VENDOR_DIR = vendorDir
    env.RELAY_VENDOR_DIR = vendorDir
    if (opts.enableControl) {
      env.DASHBOARD_ENABLE_CONTROL = '1'
      env.RELAY_ENABLE_CONTROL = '1'
    }
    if (opts.enableDispatch) {
      env.DASHBOARD_ENABLE_DISPATCH = '1'
      env.RELAY_ENABLE_DISPATCH = '1'
    }
    if (opts.tunnelOrigin) {
      env.DASHBOARD_TUNNEL_ORIGIN = opts.tunnelOrigin
      env.RELAY_TUNNEL_ORIGIN = opts.tunnelOrigin
    }
    if (opts.authUser) {
      env.DASHBOARD_AUTH_USER = opts.authUser
      env.RELAY_AUTH_USER = opts.authUser
    }
    if (opts.authPass) {
      env.DASHBOARD_AUTH_PASS = opts.authPass
      env.RELAY_AUTH_PASS = opts.authPass
    }
    if (opts.agentBoardRoot) env.AGENT_BOARD_ROOT = opts.agentBoardRoot
    if (opts.sessionRoot) env.PI_CODING_AGENT_SESSION_DIR = opts.sessionRoot
    if (opts.dispatchBoardDir) {
      env.DASHBOARD_BOARD_DIR = opts.dispatchBoardDir
      env.RELAY_BOARD_DIR = opts.dispatchBoardDir
    }
    if (opts.piCommand) {
      env.DASHBOARD_PI_COMMAND = opts.piCommand
      env.RELAY_PI_COMMAND = opts.piCommand
    }
    if (opts.piArgs?.length) {
      const joined = opts.piArgs.join(' ')
      env.DASHBOARD_PI_ARGS = joined
      env.RELAY_PI_ARGS = joined
    }

    const child = spawn(process.execPath, [serverPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    })

    const startPromise = new Promise<number | null>((resolve, reject) => {
      let stdout = ''
      const onData = (chunk: Buffer) => {
        if (this.boundPort !== null) return
        stdout += String(chunk)
        const match = stdout.match(DASHBOARD_URL_RE)
        if (match) {
          this.boundPort = Number(match[1])
          cleanup()
          resolve(this.boundPort)
        }
      }
      const onFail = (error?: unknown) => {
        cleanup()
        this.child = null
        reject(error instanceof Error ? error : new Error(String(error ?? 'dashboard failed to start')))
      }
      const cleanup = () => {
        child.stdout.off('data', onData)
        child.stderr.off('data', onData)
        child.off('error', onFail)
        child.off('close', onClose)
      }
      const onClose = (code: number | null) => {
        if (this.child === child) this.child = null
        if (this.boundPort === null) {
          onFail(new Error(`dashboard exited before binding (code ${code})`))
        }
      }
      child.stdout.on('data', onData)
      child.stderr.on('data', onData)
      child.once('error', onFail)
      child.once('close', onClose)
    })

    this.child = child
    this.startPromise = startPromise
    return startPromise
  }

  /** Terminates the dashboard process and clears state. No-op when not running. */
  stop(): void {
    const child = this.child
    if (child) {
      try {
        child.kill('SIGTERM')
      } catch {
        // already gone
      }
      this.child = null
    }
    this.boundPort = null
    this.startPromise = null
  }
}

export const dashboardServerHost = new DashboardServerHost()
