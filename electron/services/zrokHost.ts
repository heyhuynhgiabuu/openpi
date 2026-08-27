/**
 * zrok host — Electron main process only.
 * Lifecycle for the zrok reserved tunnel backing the remote (browser) dashboard.
 * Renderer never talks to zrok directly; it only reads TunnelStatus over IPC.
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'
import { classifyZrokError, type TunnelStatus } from '../ipc/tunnel'

const ZROK_URL_RE = /https:\/\/[a-z0-9][a-z0-9-]*\.(?:share|shares)\.zrok\.io\/?/i

export class ZrokHost {
  private binaryPath: string | null | undefined = undefined // undefined = not probed yet
  private status: TunnelStatus = { state: 'off' }
  private child: ReturnType<typeof spawn> | null = null

  private get pidFile(): string {
    return path.join(app.getPath('userData'), 'zrok.pid')
  }

  private get homeDir(): string {
    return app.getPath('home')
  }

  // -- binary & enrollment -----------------------------------------------------

  /** Returns the resolved binary, probing once and caching the result. */
  getZrokBinary(): string | null {
    if (this.binaryPath === undefined) this.binaryPath = this.detectZrokBinary()
    return this.binaryPath
  }

  /** Locates `zrok2` (preferred) or `zrok` using a login shell for full PATH. */
  detectZrokBinary(): string | null {
    const shell = process.env.SHELL
    if (shell && process.platform !== 'win32') {
      try {
        const res = spawnSync(shell, ['-lc', 'which zrok2 2>/dev/null || which zrok 2>/dev/null'], {
          encoding: 'utf-8',
          timeout: 5000,
          env: { HOME: os.homedir(), TERM: 'dumb', PATH: process.env.PATH ?? '' },
        })
        if (res.status === 0 && res.stdout && res.stdout.trim()) {
          return res.stdout.trim().split('\n')[0]
        }
      } catch {
        // fall through to plain PATH lookup
      }
    }
    return this.whichFromPath('zrok2') ?? this.whichFromPath('zrok')
  }

  private whichFromPath(bin: string): string | null {
    const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
    for (const dir of dirs) {
      const candidate = path.join(dir, bin)
      try {
        if (fs.statSync(candidate).isFile()) {
          fs.accessSync(candidate, fs.constants.X_OK)
          return candidate
        }
      } catch {
        // try next PATH entry
      }
    }
    return null
  }

  /** True when the account is enabled locally (zrok wrote ~/.zrok). */
  isEnrolled(): boolean {
    return fs.existsSync(path.join(this.homeDir, '.zrok'))
  }

  /** Runs `zrok enable <token> --headless`. */
  enableZrok(token: string): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
      const binary = this.getZrokBinary()
      if (!binary) {
        resolve({ ok: false, error: 'not-installed' })
        return
      }
      const child = spawn(binary, ['enable', token, '--headless'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
      })
      let stderr = ''
      child.stderr.on('data', (d) => {
        stderr += String(d)
      })
      child.on('error', () => resolve({ ok: false, error: 'not-installed' }))
      child.on('close', (code) => {
        if (code === 0) resolve({ ok: true })
        else resolve({ ok: false, error: stderr.trim() || `exit ${code}` })
      })
    })
  }

  // -- tunnel lifecycle ---------------------------------------------------------

  /**
   * Spawns a zrok share. Ephemeral uses `zrok share public`.
   * Reserved uses `zrok reserve` + `zrok share reserved <token>` (zrok v2).
   * Tunnel emits the public URL on stdout asynchronously; getStatus() reflects it.
   */
  createTunnel(
    port: number,
    reservedName: string | null,
    user: string,
    pass: string
  ): { ok: boolean; error?: string } {
    const binary = this.getZrokBinary()
    if (!binary) return { ok: false, error: 'not-installed' }

    let args: string[]
    let effectiveReservedName: string | null = reservedName

    if (reservedName) {
      // Ensure reserved share exists (zrok v2: reserve public <target>)
      const reserveArgs = [
        'reserve',
        'public',
        `http://127.0.0.1:${port}`,
        '--backend-mode',
        'proxy',
        '--basic-auth',
        `${user}:${pass}`,
        '--json-output',
        '-n',
        reservedName,
      ]
      const reserveRes = spawnSync(binary, reserveArgs, {
        encoding: 'utf-8',
        timeout: 10000,
        env: { ...process.env },
      })
      const reserveOut = (reserveRes.stdout ?? '').trim()
      const reserveErr = (reserveRes.stderr ?? '').trim()
      let reservedToken: string | null = null
      if (reserveOut) {
        try {
          const parsed = JSON.parse(reserveOut)
          if (parsed?.token) reservedToken = String(parsed.token)
        } catch {
          // not JSON — will fall back to reservedName
        }
      }
      const isConflict =
        /409|conflict|already/i.test(reserveErr) || /409|conflict/i.test(reserveOut)
      if (reserveRes.status !== 0 && !isConflict && !reservedToken) {
        const kind = classifyZrokError(reserveErr || reserveOut || `exit ${reserveRes.status}`)
        this.status = { state: 'error', error: kind }
        return { ok: false, error: kind }
      }
      const token = reservedToken ?? reservedName
      args = [
        'share',
        'reserved',
        token,
        '--headless',
        '--override-endpoint',
        `http://127.0.0.1:${port}`,
      ]
    } else {
      args = [
        'share',
        'public',
        '--backend-mode',
        'proxy',
        '--basic-auth',
        `${user}:${pass}`,
        '--headless',
        `http://127.0.0.1:${port}`,
      ]
      effectiveReservedName = null
    }

    const child = spawn(binary, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    })
    this.child = child
    this.scavengeOrphans(port)
    this.writePid(child.pid ?? 0)

    const startedAt = Date.now()
    this.status = { state: 'starting' }

    let buffer = ''
    let stderrBuf = ''
    child.stdout.on('data', (d) => {
      buffer += String(d)
      if (this.status.state !== 'running') {
        const url = this.parseUrl(buffer)
        if (url) {
          this.status = {
            state: 'running',
            reservedName: effectiveReservedName ?? undefined,
            url,
            startedAt,
          }
        }
      }
    })
    // also watch stderr — zrok v2 logs the URL as JSON on stderr in some modes
    child.stderr.on('data', (d) => {
      const text = String(d)
      stderrBuf += text
      buffer += text
      if (this.status.state !== 'running') {
        const url = this.parseUrl(text) ?? this.parseUrl(buffer)
        if (url) {
          this.status = {
            state: 'running',
            reservedName: effectiveReservedName ?? undefined,
            url,
            startedAt,
          }
        }
      }
    })
    child.on('error', (err) => {
      if (this.child === child) this.child = null
      this.removePid()
      this.status = { state: 'error', error: classifyZrokError(err.message) }
    })
    child.on('close', (code) => {
      if (this.child === child) this.child = null
      this.removePid()
      if (this.status.state !== 'running') {
        if (stderrBuf) {
          this.status = { state: 'error', error: classifyZrokError(stderrBuf) }
        } else if (code !== null && code !== 0) {
          this.status = { state: 'error', error: classifyZrokError(`zrok exited ${code}`) }
        }
      }
    })

    return { ok: true }
  }

  stopTunnel(): void {
    const child = this.child
    if (child && child.pid) {
      try {
        child.kill('SIGTERM')
      } catch {
        // already gone
      }
      this.child = null
    }
    this.cleanupStale()
    this.status = { state: 'off' }
  }

  getStatus(): TunnelStatus {
    return {
      ...this.status,
      installed: this.getZrokBinary() !== null,
      enrolled: this.isEnrolled(),
    }
  }

  // -- PID file ----------------------------------------------------------------

  writePid(pid: number): void {
    try {
      fs.writeFileSync(this.pidFile, String(pid), 'utf-8')
    } catch {
      // best-effort
    }
  }

  readPid(): number | null {
    try {
      const raw = fs.readFileSync(this.pidFile, 'utf-8').trim()
      const pid = Number(raw)
      return Number.isInteger(pid) && pid > 0 ? pid : null
    } catch {
      return null
    }
  }

  removePid(): void {
    try {
      fs.unlinkSync(this.pidFile)
    } catch {
      // nothing to remove
    }
  }

  /** Kills a previously recorded tunnel process if it is still alive. */
  cleanupStale(): void {
    const pid = this.readPid()
    if (pid && this.pidAlive(pid)) {
      try {
        process.kill(pid, 'SIGTERM')
      } catch {
        // already died
      }
    }
    this.removePid()
  }

  /** Hunts stray `zrok share` processes bound to `port` and stops them. */
  scavengeOrphans(port: number): void {
    try {
      const res = spawnSync('ps', ['-ax', '-o', 'pid=', '-o', 'command='], {
        encoding: 'utf-8',
      })
      if (res.status !== 0 || !res.stdout) return
      for (const line of res.stdout.split('\n')) {
        const m = line.match(/^\s*(\d+)\s+(.*)$/)
        if (!m) continue
        const pid = Number(m[1])
        const cmd = m[2] ?? ''
        if (
          pid !== process.pid &&
          cmd.includes('zrok') &&
          cmd.includes('share') &&
          cmd.includes(String(port))
        ) {
          try {
            process.kill(pid, 'SIGTERM')
          } catch {
            // already gone
          }
        }
      }
    } catch {
      // ps unavailable — skip orphan scavenging
    }
  }

  // -- helpers ----------------------------------------------------------------

  private parseUrl(output: string): string | null {
    const match = output.match(ZROK_URL_RE)
    return match ? match[0].replace(/\/$/, '') : null
  }

  private pidAlive(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }
}

export const zrokHost = new ZrokHost()
