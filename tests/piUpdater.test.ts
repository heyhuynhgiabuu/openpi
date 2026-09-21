import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import packageManifest from '../package.json'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const updater = await import('../electron/pi/updater')
// electron import is stubbed; the test surface we need is the pure helper.
const updaterTest = (
  updater as unknown as {
    __test: {
      detectPackageManager: (
        appPath: string,
        hasOnPath: (bin: string) => boolean
      ) => 'npm' | 'pnpm' | 'yarn' | 'bun' | null
      buildInstallArgs: (manager: 'npm' | 'pnpm' | 'yarn' | 'bun', version: string) => string[]
      isSupportedPiVersion: (version: string) => boolean
      getBundledPiVersion: () => string
      pathLookupCommand: (platform: NodeJS.Platform) => 'where.exe' | 'which'
    }
  }
).__test
const detectPackageManager = updaterTest.detectPackageManager

let tmpDir: string
const noOnPath = () => false

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-updater-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('Pi package update transaction', () => {
  it.each(['npm', 'pnpm', 'yarn', 'bun'] as const)(
    'updates the complete supported Pi family with %s',
    (manager) => {
      const args = updaterTest.buildInstallArgs(manager, '0.86.1')
      expect(args).toContain('@earendil-works/pi-coding-agent@0.86.1')
      expect(args).toContain('@earendil-works/pi-ai@0.86.1')
      expect(args).toContain('@earendil-works/pi-tui@0.86.1')
      expect(args).toContain(manager === 'npm' || manager === 'pnpm' ? '--save-exact' : '--exact')
    }
  )
})

describe('Pi version compatibility', () => {
  it('keeps the host gate aligned with the direct Pi package pins', () => {
    const piVersion = packageManifest.dependencies['@earendil-works/pi-coding-agent']
    expect(piVersion).toBe('0.86.1')
    expect(packageManifest.dependencies['@earendil-works/pi-ai']).toBe(piVersion)
    expect(packageManifest.dependencies['@earendil-works/pi-tui']).toBe(piVersion)
    expect(updaterTest.isSupportedPiVersion(piVersion)).toBe(true)
    expect(updaterTest.getBundledPiVersion()).toBe(piVersion)
  })

  it('supports only the Pi version validated by this OpenPi host', () => {
    expect(updaterTest.isSupportedPiVersion('0.86.1')).toBe(true)
    expect(updaterTest.isSupportedPiVersion('0.86.0')).toBe(false)
    expect(updaterTest.isSupportedPiVersion('0.86.2')).toBe(false)
    expect(updaterTest.isSupportedPiVersion('0.86.1-beta.1')).toBe(false)
  })

  it('refuses an unsupported future version before package-manager detection', async () => {
    const result = await updater.installPiUpdate('0.86.2')
    expect(result).toMatchObject({ ok: false, requiresRestart: false })
    expect(result.message).toContain('validated only with Pi 0.86.1')
  })
})

describe('platform package-manager lookup', () => {
  it('uses Windows `where.exe` and POSIX `which`', () => {
    expect(updaterTest.pathLookupCommand('win32')).toBe('where.exe')
    expect(updaterTest.pathLookupCommand('darwin')).toBe('which')
    expect(updaterTest.pathLookupCommand('linux')).toBe('which')
  })
})

describe('detectPackageManager', () => {
  it('uses an available package manager for the matching lockfile', () => {
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '')
    expect(detectPackageManager(tmpDir, (bin) => bin === 'pnpm')).toBe('pnpm')
  })

  it('recognizes the current bun.lock format', () => {
    fs.writeFileSync(path.join(tmpDir, 'bun.lock'), '')
    fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '{}')
    expect(detectPackageManager(tmpDir, (bin) => bin === 'bun')).toBe('bun')
  })

  it('recognizes yarn.lock when yarn is available', () => {
    fs.writeFileSync(path.join(tmpDir, 'yarn.lock'), '')
    expect(detectPackageManager(tmpDir, (bin) => bin === 'yarn')).toBe('yarn')
  })

  it('preserves pnpm preference when both supported lockfiles are present', () => {
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '')
    fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '{}')
    expect(detectPackageManager(tmpDir, (bin) => bin === 'npm' || bin === 'pnpm')).toBe('pnpm')
  })

  it('falls back to another matching lockfile when the first binary is unavailable', () => {
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '')
    fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '{}')
    expect(detectPackageManager(tmpDir, (bin) => bin === 'npm')).toBe('npm')
  })

  it('does not switch a pnpm-managed install to another manager', () => {
    fs.mkdirSync(path.join(tmpDir, 'node_modules'))
    fs.writeFileSync(path.join(tmpDir, 'node_modules', '.modules.yaml'), '')
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '')
    fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '{}')
    expect(detectPackageManager(tmpDir, (bin) => bin === 'npm')).toBeNull()
  })

  it('keeps an npm-managed install on npm when pnpm is also available', () => {
    fs.mkdirSync(path.join(tmpDir, 'node_modules'))
    fs.writeFileSync(path.join(tmpDir, 'node_modules', '.package-lock.json'), '{}')
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '')
    fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '{}')
    expect(detectPackageManager(tmpDir, () => true)).toBe('npm')
  })

  it('prefers the active pnpm layout over a stale npm hidden lock', () => {
    fs.mkdirSync(path.join(tmpDir, 'node_modules'))
    fs.writeFileSync(path.join(tmpDir, 'node_modules', '.modules.yaml'), '')
    fs.writeFileSync(path.join(tmpDir, 'node_modules', '.package-lock.json'), '{}')
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '')
    fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '{}')
    expect(detectPackageManager(tmpDir, () => true)).toBe('pnpm')
  })

  it('does not select an unavailable lockfile package manager', () => {
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '')
    expect(detectPackageManager(tmpDir, noOnPath)).toBeNull()
  })

  it('falls back to the first package manager on PATH when no lockfile exists', () => {
    // Iteration order in detectPackageManager is npm → pnpm → yarn → bun.
    expect(detectPackageManager(tmpDir, (bin) => bin === 'pnpm' || bin === 'npm')).toBe('npm')
  })

  it('returns null when no lockfile and no package manager is on PATH', () => {
    expect(detectPackageManager(tmpDir, noOnPath)).toBeNull()
  })
})
