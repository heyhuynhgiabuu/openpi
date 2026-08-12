import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

test('launches the real app with a sandboxed renderer and preload bridge', async () => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-e2e-'))
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${path.join(profileDir, 'user-data')}`],
    env: {
      ...process.env,
      HOME: path.join(profileDir, 'home'),
      OPENPI_DISABLE_AUTO_UPDATE: '1',
    },
  })

  try {
    const page = await app.firstWindow()
    await expect(page).toHaveTitle(/OpenPi/)
    await expect(page.locator('#root')).toBeAttached()
    await expect(page.locator('#root')).not.toBeEmpty()

    const rendererGlobals = await page.evaluate(() => ({
      hasBridge: typeof window.openpi === 'object',
      hasNodeRequire: typeof Reflect.get(window, 'require') === 'function',
      hasNodeProcess: typeof Reflect.get(window, 'process') === 'object',
    }))
    expect(rendererGlobals).toEqual({
      hasBridge: true,
      hasNodeRequire: false,
      hasNodeProcess: false,
    })

    const webPreferences = await app.evaluate(({ BrowserWindow }) => {
      const webContents = BrowserWindow.getAllWindows()[0]?.webContents
      const getPreferences = webContents
        ? Reflect.get(webContents, 'getLastWebPreferences')
        : undefined
      return typeof getPreferences === 'function' ? getPreferences.call(webContents) : null
    })
    expect(webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    })
  } finally {
    await app.close()
    fs.rmSync(profileDir, { recursive: true, force: true })
  }
})
