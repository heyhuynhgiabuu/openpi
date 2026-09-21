import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'
import type { PiUpdateCheckResult, PiUpdateInstallResult } from '../../src/lib/ipc'
import { piUpdateCheckResultSchema, piUpdateInstallResultSchema } from '../../src/lib/ipc'
import {
  buildInstallArgs,
  detectPackageManager,
  hasOnPath,
  pathLookupCommand,
  type PackageManager,
} from './packageManager'

const execFileAsync = promisify(execFile)

const PACKAGED_UPDATE_MESSAGE =
  'Pi updates are bundled with OpenPi releases. Update OpenPi itself to get a newer Pi.'

/** The Pi family version validated by this OpenPi host. */
export const SUPPORTED_PI_VERSION = '0.86.1'

/**
 * Read the bundled Pi SDK version from its package.json.
 */
function getBundledPiVersion(): string {
  const appRoots = new Set<string>()
  try {
    // Prefer the host's app path: process.cwd() can be a user workspace with
    // a different Pi dependency in its own node_modules.
    appRoots.add(app.getAppPath())
  } catch {
    // The app path is unavailable in isolated unit tests before Electron starts.
  }
  appRoots.add(process.cwd())

  for (const appRoot of appRoots) {
    const bundledManifest = path.join(
      appRoot,
      'node_modules',
      '@earendil-works',
      'pi-coding-agent',
      'package.json'
    )
    const bundledVersion = readPackageVersion(bundledManifest)
    if (bundledVersion != null) return bundledVersion

    const appManifest = readJsonObject(path.join(appRoot, 'package.json'))
    const declaredVersion = appManifest?.dependencies?.['@earendil-works/pi-coding-agent']
    if (typeof declaredVersion === 'string') return declaredVersion
  }

  return '0.0.0'
}

function readPackageVersion(packageJsonPath: string): string | null {
  const packageJson = readJsonObject(packageJsonPath)
  return typeof packageJson?.version === 'string' ? packageJson.version : null
}

function readJsonObject(filePath: string): {
  version?: unknown
  dependencies?: Record<string, unknown>
} | null {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
    const record = value as Record<string, unknown>
    const dependencies = record.dependencies
    return {
      version: record.version,
      dependencies:
        typeof dependencies === 'object' && dependencies !== null && !Array.isArray(dependencies)
          ? (dependencies as Record<string, unknown>)
          : undefined,
    }
  } catch {
    return null
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

export function isSupportedPiVersion(version: string): boolean {
  return version === SUPPORTED_PI_VERSION
}

function unsupportedPiVersionMessage(version: string): string {
  return `Pi ${version} is available, but this OpenPi build is validated only with Pi ${SUPPORTED_PI_VERSION}. Update OpenPi before installing it.`
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
    const newerVersion = latestVersion != null && compareSemver(latestVersion, currentVersion) > 0
    const supportedUpdate = latestVersion != null && isSupportedPiVersion(latestVersion)
    const compatibleVersion = newerVersion && supportedUpdate && !app.isPackaged

    return piUpdateCheckResultSchema.parse({
      currentVersion,
      latestVersion,
      packageName,
      updateAvailable: compatibleVersion,
      checkedAt,
      error:
        latestVersion == null
          ? 'Latest version response did not include a version.'
          : newerVersion && supportedUpdate && app.isPackaged
            ? PACKAGED_UPDATE_MESSAGE
            : newerVersion && !compatibleVersion
              ? unsupportedPiVersionMessage(latestVersion)
              : null,
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
 * Update the bundled Pi SDK by installing matching `pi-coding-agent`, `pi-ai`, and
 * `pi-tui` versions in one package-manager transaction. A full app restart is required
 * to pick up the new SDK code.
 *
 * OpenPi does not depend on a global `pi` CLI (it imports the SDK directly),
 * so `pi update --self` does not apply to the bundled install — running it
 * for a user without a separately-installed `pi` CLI surfaces
 * 'This installation is not managed by a global npm install' and
 * nothing changes on disk. We instead drive the package manager
 * OpenPi itself was installed with.
 */
export async function installPiUpdate(latestVersion: string): Promise<PiUpdateInstallResult> {
  if (!isSupportedPiVersion(latestVersion)) {
    return piUpdateInstallResultSchema.parse({
      ok: false,
      requiresRestart: false,
      output: '',
      message: unsupportedPiVersionMessage(latestVersion),
    })
  }

  // A packaged app runs from a read-only app.asar and does not contain the
  // workspace lockfiles needed to mutate its embedded node_modules. Ship Pi
  // changes with the next OpenPi release instead of invoking a package manager
  // against the immutable bundle.
  if (app.isPackaged) {
    return piUpdateInstallResultSchema.parse({
      ok: false,
      requiresRestart: false,
      output: '',
      message: PACKAGED_UPDATE_MESSAGE,
    })
  }

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

export const __test = {
  buildInstallArgs,
  detectPackageManager,
  hasOnPath,
  isSupportedPiVersion,
  getBundledPiVersion,
  pathLookupCommand,
}

async function installBundledPi(
  pkgManager: PackageManager,
  latestVersion: string,
  appPath: string
): Promise<PiUpdateInstallResult> {
  const args = buildInstallArgs(pkgManager, latestVersion)
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
