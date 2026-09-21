import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { getAppPath, getVersion, packagedState } = vi.hoisted(() => ({
  getAppPath: vi.fn(),
  getVersion: vi.fn(() => '0.2.14'),
  packagedState: { value: true },
}))

vi.mock('electron', () => ({
  app: {
    getAppPath,
    getVersion,
    get isPackaged() {
      return packagedState.value
    },
  },
}))

const tempRoots: string[] = []

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  packagedState.value = true
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

const updater = await import('../electron/pi/updater')

describe('packaged Pi updater', () => {
  it('allows a supported update in a development install', async () => {
    packagedState.value = false
    const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-dev-updater-'))
    tempRoots.push(appRoot)
    getAppPath.mockReturnValue(appRoot)
    fs.writeFileSync(
      path.join(appRoot, 'package.json'),
      JSON.stringify({ dependencies: { '@earendil-works/pi-coding-agent': '0.86.0' } })
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ version: '0.86.1' }),
      }))
    )

    const result = await updater.checkPiUpdate()

    expect(result).toMatchObject({
      currentVersion: '0.86.0',
      latestVersion: '0.86.1',
      updateAvailable: true,
      error: null,
    })
  })

  it('does not advertise an install that the packaged app cannot perform', async () => {
    const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-packaged-updater-'))
    tempRoots.push(appRoot)
    getAppPath.mockReturnValue(appRoot)
    fs.writeFileSync(
      path.join(appRoot, 'package.json'),
      JSON.stringify({ dependencies: { '@earendil-works/pi-coding-agent': '0.86.0' } })
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ version: '0.86.1' }),
      }))
    )

    const result = await updater.checkPiUpdate()

    expect(result).toMatchObject({
      currentVersion: '0.86.0',
      latestVersion: '0.86.1',
      updateAvailable: false,
      error: 'Pi updates are bundled with OpenPi releases. Update OpenPi itself to get a newer Pi.',
    })
  })

  it('refuses to mutate the read-only app bundle', async () => {
    const result = await updater.installPiUpdate('0.86.1')

    expect(result).toMatchObject({
      ok: false,
      requiresRestart: false,
      message:
        'Pi updates are bundled with OpenPi releases. Update OpenPi itself to get a newer Pi.',
    })
    expect(getAppPath).not.toHaveBeenCalled()
  })
})
