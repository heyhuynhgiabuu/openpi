/**
 * zrok.json persistence — Electron main process only.
 * Stores the tunnel auto-restart config in `userData/zrok.json`.
 *
 * The zrok enrollment token is a secret, so it is encrypted with Electron's
 * safeStorage where available; otherwise it falls back to a `plain:`-prefixed
 * literal so the file stays readable across platforms without OS keychains.
 */
import fs from 'node:fs'
import path from 'node:path'
import { app, safeStorage } from 'electron'

/** Persistent tunnel config as stored in userData/zrok.json. */
export interface ZrokConfig {
  /** Restart the tunnel automatically at app launch. */
  persistent: boolean
  /** DNS-safe reserved name → stable public URL. */
  reservedName?: string
  /** zrok enrollment token; encrypted in the file via safeStorage. */
  token?: string
}

const FILE = 'zrok.json'
const PLAIN_PREFIX = 'plain:'

function configPath(): string {
  return path.join(app.getPath('userData'), FILE)
}

function canEncrypt(): boolean {
  return app.isReady() && safeStorage.isEncryptionAvailable()
}

function encryptSecret(plain: string): string {
  if (canEncrypt()) return safeStorage.encryptString(plain).toString('base64')
  return PLAIN_PREFIX + plain
}

function decryptSecret(stored: string): string {
  if (stored.startsWith(PLAIN_PREFIX)) return stored.slice(PLAIN_PREFIX.length)
  try {
    if (canEncrypt()) return safeStorage.decryptString(Buffer.from(stored, 'base64'))
  } catch {
    // corrupted or undecryptable — return the stored value as-is
  }
  return stored
}

/** Reads and decrypts userData/zrok.json; null when absent or unreadable. */
export function readZrokConfig(): ZrokConfig | null {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), 'utf-8')) as Record<string, unknown>
    return {
      persistent: raw.persistent === true,
      reservedName: typeof raw.reservedName === 'string' ? raw.reservedName : undefined,
      token: typeof raw.token === 'string' ? decryptSecret(raw.token) : undefined,
    }
  } catch {
    return null
  }
}

/** Writes userData/zrok.json, encrypting the token before it touches disk. */
export function writeZrokConfig(cfg: {
  persistent: boolean
  reservedName?: string
  token?: string
}): void {
  const payload: Record<string, unknown> = { persistent: cfg.persistent }
  if (cfg.reservedName) payload.reservedName = cfg.reservedName
  if (cfg.token) payload.token = encryptSecret(cfg.token)
  try {
    fs.writeFileSync(configPath(), JSON.stringify(payload, null, 2), 'utf-8')
  } catch {
    // best-effort — a failed write must not break the tunnel session
  }
}

/** Removes userData/zrok.json so the tunnel no longer auto-restarts. */
export function clearZrokConfig(): void {
  try {
    fs.unlinkSync(configPath())
  } catch {
    // nothing to remove
  }
}
