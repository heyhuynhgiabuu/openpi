import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const updater = await import('../electron/pi/updater')
// electron import is stubbed; the test surface we need is the pure helper.
const detectPackageManager = (
  updater as unknown as {
    __test: {
      detectPackageManager: (
        appPath: string,
        hasOnPath: (bin: string) => boolean
      ) => 'npm' | 'pnpm' | 'yarn' | 'bun' | null
    }
  }
).__test.detectPackageManager

let tmpDir: string
const noOnPath = () => false

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-updater-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('detectPackageManager', () => {
  it('prefers pnpm when pnpm-lock.yaml is present', () => {
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '')
    expect(detectPackageManager(tmpDir, noOnPath)).toBe('pnpm')
  })

  it('prefers yarn when yarn.lock is present', () => {
    fs.writeFileSync(path.join(tmpDir, 'yarn.lock'), '')
    expect(detectPackageManager(tmpDir, noOnPath)).toBe('yarn')
  })

  it('prefers bun when bun.lockb is present', () => {
    fs.writeFileSync(path.join(tmpDir, 'bun.lockb'), '')
    expect(detectPackageManager(tmpDir, noOnPath)).toBe('bun')
  })

  it('prefers npm when package-lock.json is present', () => {
    fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '{}')
    expect(detectPackageManager(tmpDir, noOnPath)).toBe('npm')
  })

  it('falls back to the first package manager on PATH when no lockfile exists', () => {
    // Iteration order in detectPackageManager is npm → pnpm → yarn → bun.
    expect(detectPackageManager(tmpDir, (bin) => bin === 'pnpm' || bin === 'npm')).toBe('npm')
  })

  it('returns null when no lockfile and no package manager is on PATH', () => {
    expect(detectPackageManager(tmpDir, noOnPath)).toBeNull()
  })
})
