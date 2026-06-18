import { execFile } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'
import type { PiUpdateCheckResult, PiUpdateInstallResult } from '../../src/lib/ipc'
import { piUpdateCheckResultSchema, piUpdateInstallResultSchema } from '../../src/lib/ipc'

const require = createRequire(import.meta.url)
const execFileAsync = promisify(execFile)

/**
 * Read the bundled Pi SDK version from its package.json.
 */
function getBundledPiVersion(): string {
  try {
    const entryPath = require.resolve('@earendil-works/pi-coding-agent')
    const packageJsonPath = path.resolve(path.dirname(entryPath), '..', 'package.json')
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as {
      version?: unknown
    }
    return typeof packageJson.version === 'string' ? packageJson.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/**
 * Compare two semver strings. Returns >0 if a > b, <0 if a < b, 0 if equal.
 */
export function compareSemver(a: string, b: string): number {
  const parse = (version: string) =>
    version
      .split('-')[0]
      ?.split('.')
      .map((part) => Number(part) || 0) ?? []
  const left = parse(a)
  const right = parse(b)
  for (let i = 0; i < Math.max(left.length, right.length, 3); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/**
 * Check the latest version of Pi from the registry.
 */
export async function checkPiUpdate(): Promise<PiUpdateCheckResult> {
  const currentVersion = getBundledPiVersion()
  const checkedAt = new Date().toISOString()

  try {
    const response = await fetch('https://pi.dev/api/latest-version', {
      headers: { 'user-agent': `openpi/${app.getVersion()} pi/${currentVersion}` },
    })
    if (!response.ok) throw new Error(`latest-version returned HTTP ${response.status}`)

    const data = (await response.json()) as {
      ok?: unknown
      version?: unknown
      packageName?: unknown
    }
    const latestVersion = typeof data.version === 'string' ? data.version : null
    const packageName =
      typeof data.packageName === 'string' ? data.packageName : '@earendil-works/pi-coding-agent'

    return piUpdateCheckResultSchema.parse({
      currentVersion,
      latestVersion,
      packageName,
      updateAvailable: latestVersion != null && compareSemver(latestVersion, currentVersion) > 0,
      checkedAt,
      error: latestVersion ? null : 'Latest version response did not include a version.',
    })
  } catch (err) {
    return piUpdateCheckResultSchema.parse({
      currentVersion,
      latestVersion: null,
      packageName: null,
      updateAvailable: false,
      checkedAt,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/**
 * Update the bundled Pi SDK by reinstalling `@earendil-works/pi-coding-agent@<latest>`
 * in OpenPi's own `node_modules/`. A full app restart is required to pick
 * up the new SDK code.
 *
 * OpenPi does not depend on a global `pi` CLI (it imports the SDK directly),
 * so `pi update --self` does not apply to the bundled install — running it
 * for a user without a separately-installed `pi` CLI surfaces
 * 'This installation is not managed by a global npm install' and
 * nothing changes on disk. We instead drive the package manager
 * OpenPi itself was installed with.
 */
export async function installPiUpdate(latestVersion: string): Promise<PiUpdateInstallResult> {
  const appPath = app.getAppPath()
  const pkgManager = detectPackageManager(appPath)
  if (!pkgManager) {
    return piUpdateInstallResultSchema.parse({
      ok: false,
      requiresRestart: false,
      output: '',
      message:
        'Could not detect a package manager (npm/pnpm/yarn/bun) for this OpenPi install. Update OpenPi itself to get a newer Pi.',
    })
  }
  return installBundledPi(pkgManager, latestVersion, appPath)
}

function detectPackageManager(
  appPath: string,
  hasOnPathFn: (bin: string) => boolean = hasOnPath
): 'npm' | 'pnpm' | 'yarn' | 'bun' | null {
  if (fs.existsSync(path.join(appPath, 'pnpm-lock.yaml'))) return 'pnpm'
  if (fs.existsSync(path.join(appPath, 'yarn.lock'))) return 'yarn'
  if (fs.existsSync(path.join(appPath, 'bun.lockb'))) return 'bun'
  if (fs.existsSync(path.join(appPath, 'package-lock.json'))) return 'npm'
  // No lockfile — fall back to the first package manager on PATH.
  for (const candidate of ['npm', 'pnpm', 'yarn', 'bun'] as const) {
    if (hasOnPathFn(candidate)) return candidate
  }
  return null
}

function hasOnPath(bin: string): boolean {
  try {
    const { execFileSync } = require('node:child_process') as typeof import('node:child_process')
    execFileSync('which', [bin], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

export const __test = { detectPackageManager, hasOnPath }

async function installBundledPi(
  pkgManager: 'npm' | 'pnpm' | 'yarn' | 'bun',
  latestVersion: string,
  appPath: string
): Promise<PiUpdateInstallResult> {
  const spec = `@earendil-works/pi-coding-agent@${latestVersion}`
  const args =
    pkgManager === 'npm'
      ? ['install', '--ignore-scripts', '--no-audit', '--no-fund', spec]
      : pkgManager === 'pnpm'
        ? ['add', '--ignore-scripts', spec]
        : pkgManager === 'yarn'
          ? ['add', '--ignore-scripts', spec]
          : ['add', spec] // bun add does not support --ignore-scripts; bun install runs scripts off by default
  try {
    const { stdout, stderr } = await execFileAsync(pkgManager, args, {
      cwd: appPath,
      timeout: 5 * 60 * 1000,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, NPM_CONFIG_FUND: 'false' },
    })
    const output = `${stdout}${stderr}`.trim()
    return piUpdateInstallResultSchema.parse({
      ok: true,
      requiresRestart: true,
      output,
      message: `Pi ${latestVersion} installed. Restart OpenPi to use it.`,
    })
  } catch (err) {
    const error = err as { stdout?: unknown; stderr?: unknown; message?: unknown }
    const output = [error.stdout, error.stderr, error.message]
      .filter((part): part is string => typeof part === 'string' && part.length > 0)
      .join('\n')
    return piUpdateInstallResultSchema.parse({
      ok: false,
      requiresRestart: false,
      output,
      message: `Failed to install Pi ${latestVersion}: ${(error.message as string | undefined) ?? output.split('\n').pop() ?? 'unknown error'}`,
    })
  }
}
