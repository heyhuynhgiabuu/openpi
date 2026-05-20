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
 * Run `pi update --self` to update the bundled Pi CLI.
 */
export async function installPiUpdate(): Promise<PiUpdateInstallResult> {
  const command = process.platform === 'win32' ? 'pi.cmd' : 'pi'
  try {
    const { stdout, stderr } = await execFileAsync(command, ['update', '--self'], {
      timeout: 5 * 60 * 1000,
      maxBuffer: 1024 * 1024,
    })
    return piUpdateInstallResultSchema.parse({ ok: true, output: `${stdout}${stderr}`.trim() })
  } catch (err) {
    const error = err as { code?: unknown; stdout?: unknown; stderr?: unknown; message?: unknown }
    const output = [error.stdout, error.stderr, error.message]
      .filter((part): part is string => typeof part === 'string' && part.length > 0)
      .join('\n')
    const missingCliMessage =
      'Pi CLI executable was not found on PATH. OpenPi package install/remove uses the bundled Pi SDK, but self-update requires the standalone `pi` CLI. Install it or expose it on PATH, then run `pi update --self`.'
    return piUpdateInstallResultSchema.parse({
      ok: false,
      output: error.code === 'ENOENT' ? missingCliMessage : output || 'pi update --self failed.',
    })
  }
}
