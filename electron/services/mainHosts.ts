import fs from 'node:fs'
import path from 'node:path'
import type * as GitHost from '../git/gitHost'
import type * as CustomizationsHost from './customizations'
import type * as FffHost from './fffHost'
import type { PtyHost } from './ptyHost'

type PtyHostInstance = InstanceType<typeof PtyHost>

let fffHostPromise: Promise<typeof FffHost> | null = null
let customizationsHostPromise: Promise<typeof CustomizationsHost> | null = null
let gitHostPromise: Promise<typeof GitHost> | null = null
let ptyHostPromise: Promise<PtyHostInstance> | null = null

export async function getCustomizationsHost(): Promise<typeof CustomizationsHost> {
  customizationsHostPromise ??= import('./customizations')
  return customizationsHostPromise
}

export async function getFffHost(): Promise<typeof FffHost> {
  fffHostPromise ??= import('./fffHost')
  return fffHostPromise
}

export async function ensureFffInitialized(cwd: string): Promise<typeof FffHost | null> {
  const workspacePath = resolveFffCwd(cwd)
  if (!workspacePath) return null
  const host = await getFffHost()
  // Always delegate to initFff — it is idempotent via its own guard. Keeping the
  // guard in fffHost avoids permanently suppressing retries after init failures.
  await host.initFff(workspacePath)
  return host
}

function resolveFffCwd(cwd: string): string | null {
  if (!path.isAbsolute(cwd)) return null
  try {
    return fs.statSync(cwd).isDirectory() ? path.resolve(cwd) : null
  } catch {
    return null
  }
}

export async function getGitHost(): Promise<typeof GitHost> {
  gitHostPromise ??= import('../git/gitHost')
  return gitHostPromise
}

export function hasGitHost(): boolean {
  return Boolean(gitHostPromise)
}

export async function getPtyHost(): Promise<PtyHostInstance> {
  ptyHostPromise ??= import('./ptyHost').then((m) => m.ptyHost)
  return ptyHostPromise
}

export function hasPtyHost(): boolean {
  return Boolean(ptyHostPromise)
}

export function hasFffHost(): boolean {
  return Boolean(fffHostPromise)
}
