/**
 * zrok tunnel remote dashboard — IPC contract & validation.
 *
 * t-003: TDD red phase. Signatures, enum values and Zod schemas define the
 * wire/validation contract that the tests assert against.
 * t-004: real validation, zrok stderr classification and status schema.
 */

import { randomBytes } from 'node:crypto'
import type { IpcMain } from 'electron'
import QRCode from 'qrcode'
import { z } from 'zod'
import { IPC } from '../../src/lib/ipc'
import type { RelayServerHost } from '../services/relayServerHost'
import { clearZrokConfig, writeZrokConfig } from '../services/zrokConfig'
import type { ZrokHost } from '../services/zrokHost'

// IPC handlers — wire renderer requests to the lazy singleton hosts.
export function registerTunnelIpc(deps: {
  ipcMain: IpcMain
  getZrokHost: () => Promise<ZrokHost>
  getRelayServerHost: () => Promise<RelayServerHost>
}): void {
  deps.ipcMain.handle(IPC.TUNNEL_GET_STATUS, async () => {
    const host = await deps.getZrokHost()
    return host.getStatus()
  })
  deps.ipcMain.handle(IPC.TUNNEL_GET_URL, async () => {
    const host = await deps.getZrokHost()
    return host.getStatus().url ?? null
  })
  deps.ipcMain.handle(IPC.TUNNEL_ENABLE, async (_event, raw: unknown) => {
    const { token, persistent, reservedName } = tunnelEnableSchema.parse(raw)
    const host = await deps.getZrokHost()
    // A non-empty token enrolls the local zrok account first.
    if (token) {
      const enrolled = await host.enableZrok(token)
      if (!enrolled.ok) return enrolled
    }
    // Persist the auto-restart config so the tunnel survives relaunch.
    if (persistent) {
      writeZrokConfig({ persistent: true, reservedName, token })
    } else {
      clearZrokConfig()
    }
    // With an enrolled account and an idle tunnel, "enable" acts as Connect
    // (token-less) and starts the share against the local relay server.
    if (host.isEnrolled() && host.getStatus().state === 'off') {
      return startTunnel(deps, reservedName)
    }
    return { ok: true }
  })
  deps.ipcMain.handle(IPC.TUNNEL_GENERATE_QR, async (_event, raw: unknown) =>
    generateTunnelQr(typeof raw === 'string' ? raw : '')
  )
  deps.ipcMain.handle(IPC.TUNNEL_DISABLE, async () => {
    const zrok = await deps.getZrokHost()
    zrok.stopTunnel()
    zrok.removePid()
    zrok.cleanupStale()
    const relay = await deps.getRelayServerHost()
    relay.stop()
    clearZrokConfig()
  })
}

/**
 * Starts the local relay server and exposes it through a zrok share.
 * Ephemeral basic-auth credentials are minted per start (never persisted).
 */
export async function startTunnel(
  deps: {
    getZrokHost: () => Promise<ZrokHost>
    getRelayServerHost: () => Promise<RelayServerHost>
  },
  reservedName?: string
): Promise<{ ok: boolean; error?: string }> {
  const host = await deps.getZrokHost()
  const relay = await deps.getRelayServerHost()
  const user = 'relay'
  const pass = randomBytes(18).toString('base64url')
  const port = await relay.start({ authUser: user, authPass: pass })
  if (port === null) return { ok: false, error: 'relay failed to start' }
  // A persisted reserved name yields a stable URL; otherwise fall back to an
  // ephemeral share URL.
  return host.createTunnel(port, reservedName || null, user, pass)
}

/**
 * Renders a zrok tunnel URL to a QR code as an inline PNG data URL.
 * The QR is generated in Electron main (renderer never owns a QR encoder).
 */
export async function generateTunnelQr(url: string): Promise<string> {
  if (!url) throw new Error('No tunnel URL to encode')
  return QRCode.toDataURL(url, { width: 220, margin: 1 })
}

export type TunnelState = 'off' | 'starting' | 'running' | 'error'

export type TunnelErrorKind =
  | 'not-installed'
  | 'not-enabled'
  | 'auth-failed'
  | 'name-conflict'
  | 'offline'
  | 'unknown'

/**
 * DNS-safe zrok `reserved` name: `^[a-z0-9][a-z0-9-]{0,62}$`, max 63 chars.
 */
const DNS_SAFE_RESERVED_NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
export const isDnsSafeReservedName = (name: string): boolean => DNS_SAFE_RESERVED_NAME_RE.test(name)

/**
 * Classifies zrok CLI stderr into a stable error kind the renderer can act on.
 */
export function classifyZrokError(stderr: string): TunnelErrorKind {
  const e = stderr.toLowerCase()
  if (!e) return 'unknown'
  if (/command not found|\bno such file or directory\b/.test(e)) return 'not-installed'
  if (/not enabled|please run\b.*\bzrok enable/.test(e)) return 'not-enabled'
  if (/unauthorized|authentication failed|invalid token/.test(e)) return 'auth-failed'
  if (/reserved|already (in use|reserved)|name conflict/.test(e)) return 'name-conflict'
  if (/connection refused|network is unreachable|no route to host|i\/o timeout/.test(e))
    return 'offline'
  return 'unknown'
}

// --- Status contract -------------------------------------------------------
/** Shape pushed to the renderer about tunnel lifecycle. */
export const tunnelStatusSchema = z
  .object({
    state: z.enum(['off', 'starting', 'running', 'error']),
    reservedName: z.string().optional(),
    url: z.string().optional(),
    error: z.string().nullable().optional(),
    startedAt: z.number().optional(),
    /** zrok binary resolvable on this host. */
    installed: z.boolean().optional(),
    /** zrok account enabled locally (~/.zrok present). */
    enrolled: z.boolean().optional(),
  })
  .strict()
export type TunnelStatus = z.infer<typeof tunnelStatusSchema>

// --- IPC request contracts --------------------------------------------------
/** Renderer enables the local zrok account: token required, persistence optional. */
export const tunnelEnableSchema = z
  .object({
    token: z.string(),
    persistent: z.boolean().optional(),
    reservedName: z.string().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    // A user-provided reserved name must already pass the DNS-safe rule in
    // main so an invalid name never reaches `zrok share`.
    if (val.reservedName && !isDnsSafeReservedName(val.reservedName)) {
      ctx.addIssue({ code: 'custom', path: ['reservedName'], message: 'not DNS-safe' })
    }
  })

/** Request to open the tunnel; reservedName optional (ephemeral if absent). */
export const tunnelStartSchema = z
  .object({
    reservedName: z.string().optional(),
    persistent: z.boolean().optional(),
  })
  .strict()

/** Request to close the tunnel: no payload. */
export const tunnelStopSchema = z.object({}).strict()
