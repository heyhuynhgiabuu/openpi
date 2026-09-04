import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { expect, test } from '@playwright/test'

function contentType(filePath: string): string {
  switch (path.extname(filePath)) {
    case '.html':
      return 'text/html; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.js':
      return 'application/javascript; charset=utf-8'
    case '.json':
      return 'application/json; charset=utf-8'
    case '.svg':
      return 'image/svg+xml'
    case '.png':
      return 'image/png'
    case '.ico':
      return 'image/x-icon'
    case '.map':
      return 'application/json'
    default:
      return 'application/octet-stream'
  }
}

function createStaticServer(rendererPath: string) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)
    const pathname = url.pathname
    // Do not handle /api/ipc – let 404 so page.route can mock, but we still need security headers for static
    if (pathname.startsWith('/api/')) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'not mocked' }))
      return
    }
    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
    const filePath = path.normalize(path.join(rendererPath, rel))
    if (!filePath.startsWith(rendererPath)) {
      res.writeHead(403)
      res.end('forbidden')
      return
    }
    const tryServe = (fp: string): boolean => {
      if (!fs.existsSync(fp)) return false
      const stat = fs.statSync(fp)
      if (stat.isDirectory()) return false
      const buf = fs.readFileSync(fp)
      res.writeHead(200, { 'Content-Type': contentType(fp), 'Cache-Control': 'no-cache' })
      res.end(buf)
      return true
    }
    if (tryServe(filePath)) return
    const fallback = path.join(rendererPath, 'index.html')
    if (tryServe(fallback)) return
    res.writeHead(404)
    res.end('not found')
  })
  return server
}

test.describe('browser tunnel workspace picker', () => {
  let server: http.Server
  let baseUrl: string

  test.beforeAll(async () => {
    const rendererPath = path.resolve(process.cwd(), 'out/renderer')
    if (!fs.existsSync(rendererPath) || !fs.existsSync(path.join(rendererPath, 'index.html'))) {
      throw new Error(`renderer not built at ${rendererPath} – run npm run build first`)
    }
    server = createStaticServer(rendererPath)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const addr = server.address() as { port: number }
    baseUrl = `http://127.0.0.1:${addr.port}`
  })

  test.afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  test('shows BrowserWelcome with absolute path input on web (no native dialog)', async ({
    page,
  }) => {
    const emptyUsage = {
      generatedAt: new Date().toISOString(),
      workspacePath: null,
      days: 30,
      lifetime: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, durationMs: 0, cost: 0, turnCount: 0, sessionCount: 0, cacheHitRate: null, activeDays: 0, longestTaskMs: null },
      today: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, durationMs: 0, cost: 0, turnCount: 0, sessionCount: 0, cacheHitRate: null },
      last7Days: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, durationMs: 0, cost: 0, turnCount: 0, sessionCount: 0, cacheHitRate: null },
      last30Days: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, durationMs: 0, cost: 0, turnCount: 0, sessionCount: 0, cacheHitRate: null },
      currentStreakDays: 0,
      longestStreakDays: 0,
      peakDay: null,
      daily: [],
      models: [],
      dailyModels: [],
      previousRange: { days: 30, models: [] },
    }
    await page.route('**/api/ipc/**', async (route) => {
      const url = route.request().url()
      const channel = decodeURIComponent(url.split('/api/ipc/')[1] ?? '')
      if (channel.includes('get-workspaces')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
        return
      }
      if (channel.includes('get-sessions')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
        return
      }
      if (channel.includes('get-usage-summary')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(emptyUsage) })
        return
      }
      if (channel.includes('get-first-run')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(false) })
        return
      }
      if (channel.includes('get-app-info')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ name: 'OpenPi', version: '0.2.7', releaseChannel: null }) })
        return
      }
      if (channel.includes('get-pref') || channel.includes('get-customizations') || channel.includes('get-workspace-summary') || channel.includes('get-git-branch') || channel.includes('tunnel')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(null) })
        return
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(null) })
    })

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
    // Web mode now shows Homescreen directly (not Welcome splash) – less ugly, matches user request
    await expect(page.locator('.homescreen')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('.homescreen-left-heading')).toBeVisible({ timeout: 5000 })
    await expect(page.locator('.homescreen-left-heading')).toHaveText('Projects')
    // Homescreen empty state shows No projects + add button
    await expect(page.getByText('No projects')).toBeVisible()
    // Click Open workspace (homescreen-left-add) should open modal with absolute path placeholder
    await page.locator('.homescreen-left-add').click()
    await expect(page.locator('#openpi-workspace-picker')).toBeVisible({ timeout: 5000 })
    await expect(page.locator('#openpi-workspace-picker').getByPlaceholder('/home/andrea/Projects/openpi')).toBeVisible()
    await page.locator('#openpi-workspace-picker').getByRole('button', { name: 'Cancel' }).click()
    await expect(page.locator('#openpi-workspace-picker')).not.toBeVisible()
  })

  test('validates relative path and shows error, then accepts absolute', async ({ page }) => {
    const emptyUsage = {
      generatedAt: new Date().toISOString(),
      workspacePath: null,
      days: 30,
      lifetime: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, durationMs: 0, cost: 0, turnCount: 0, sessionCount: 0, cacheHitRate: null, activeDays: 0, longestTaskMs: null },
      today: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, durationMs: 0, cost: 0, turnCount: 0, sessionCount: 0, cacheHitRate: null },
      last7Days: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, durationMs: 0, cost: 0, turnCount: 0, sessionCount: 0, cacheHitRate: null },
      last30Days: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, durationMs: 0, cost: 0, turnCount: 0, sessionCount: 0, cacheHitRate: null },
      currentStreakDays: 0,
      longestStreakDays: 0,
      peakDay: null,
      daily: [],
      models: [],
      dailyModels: [],
      previousRange: { days: 30, models: [] },
    }
    await page.route('**/api/ipc/**', async (route) => {
      const url = route.request().url()
      const channel = decodeURIComponent(url.split('/api/ipc/')[1] ?? '')
      if (channel.includes('get-workspaces')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
        return
      }
      if (channel.includes('get-sessions')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
        return
      }
      if (channel.includes('get-usage-summary')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(emptyUsage) })
        return
      }
      if (channel.includes('get-first-run')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(false) })
        return
      }
      if (channel.includes('get-app-info')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ name: 'OpenPi', version: '0.2.7', releaseChannel: null }) })
        return
      }
      if (channel.includes('get-pref') || channel.includes('get-customizations')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(null) })
        return
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(null) })
    })

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.homescreen')).toBeVisible({ timeout: 10000 })
    // Open modal via homescreen add button
    await page.locator('.homescreen-left-add').click()
    const modal = page.locator('#openpi-workspace-picker')
    await expect(modal).toBeVisible({ timeout: 5000 })
    const input = modal.getByPlaceholder('/home/andrea/Projects/openpi')
    await expect(input).toBeVisible()

    // Enter relative path and click Open -> should show validation error (modal client-side, not server)
    await input.fill('relative/path')
    await modal.getByRole('button', { name: /^Open$/ }).click()
    await expect(modal.getByText('Path must be absolute')).toBeVisible({ timeout: 3000 })
    // Still open
    await expect(modal).toBeVisible()
    await modal.getByRole('button', { name: 'Cancel' }).click()
    await expect(modal).not.toBeVisible()
  })

  test('shows known projects list and allows picking', async ({ page }) => {
    const workspaces = [
      {
        path: '/home/andrea/Projects/openpi',
        displayName: 'openpi',
        lastOpenedAt: null,
        sessionCount: 2,
      },
      {
        path: '/home/andrea/Projects/demo',
        displayName: 'demo',
        lastOpenedAt: null,
        sessionCount: 1,
      },
    ]
    const emptyUsage = {
      generatedAt: new Date().toISOString(),
      workspacePath: null,
      days: 30,
      lifetime: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, durationMs: 0, cost: 0, turnCount: 0, sessionCount: 0, cacheHitRate: null, activeDays: 0, longestTaskMs: null },
      today: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, durationMs: 0, cost: 0, turnCount: 0, sessionCount: 0, cacheHitRate: null },
      last7Days: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, durationMs: 0, cost: 0, turnCount: 0, sessionCount: 0, cacheHitRate: null },
      last30Days: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, durationMs: 0, cost: 0, turnCount: 0, sessionCount: 0, cacheHitRate: null },
      currentStreakDays: 0,
      longestStreakDays: 0,
      peakDay: null,
      daily: [],
      models: [],
      dailyModels: [],
      previousRange: { days: 30, models: [] },
    }
    await page.route('**/api/ipc/**', async (route) => {
      const url = route.request().url()
      const channel = decodeURIComponent(url.split('/api/ipc/')[1] ?? '')
      if (channel.includes('get-workspaces')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(workspaces) })
        return
      }
      if (channel.includes('get-sessions')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
        return
      }
      if (channel.includes('get-usage-summary')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(emptyUsage) })
        return
      }
      if (channel.includes('get-first-run')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(false) })
        return
      }
      if (channel.includes('get-app-info')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ name: 'OpenPi', version: '0.2.7', releaseChannel: null }) })
        return
      }
      if (channel.includes('get-pref') || channel.includes('get-customizations')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(null) })
        return
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(null) })
    })

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.homescreen')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('.homescreen-left-heading')).toBeVisible({ timeout: 5000 })
    await expect(page.locator('.homescreen-project').filter({ hasText: 'openpi' })).toBeVisible()
    await expect(page.locator('.homescreen-project').filter({ hasText: 'demo' })).toBeVisible()
    // Click openpi project should select it (no modal)
    await page.locator('.homescreen-project').filter({ hasText: 'openpi' }).click()
    await expect(page.locator('.homescreen-project.is-selected').filter({ hasText: 'openpi' })).toBeVisible()
  })

  test('webBridge modal via pickWorkspace without payload', async ({ page }) => {
    const workspaces = [{ path: '/home/andrea/Projects/openpi', displayName: 'openpi' }]
    const emptyUsage = {
      generatedAt: new Date().toISOString(),
      workspacePath: null,
      days: 30,
      lifetime: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, durationMs: 0, cost: 0, turnCount: 0, sessionCount: 0, cacheHitRate: null, activeDays: 0, longestTaskMs: null },
      today: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, durationMs: 0, cost: 0, turnCount: 0, sessionCount: 0, cacheHitRate: null },
      last7Days: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, durationMs: 0, cost: 0, turnCount: 0, sessionCount: 0, cacheHitRate: null },
      last30Days: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, durationMs: 0, cost: 0, turnCount: 0, sessionCount: 0, cacheHitRate: null },
      currentStreakDays: 0,
      longestStreakDays: 0,
      peakDay: null,
      daily: [],
      models: [],
      dailyModels: [],
      previousRange: { days: 30, models: [] },
    }
    await page.route('**/api/ipc/**', async (route) => {
      const url = route.request().url()
      const channel = decodeURIComponent(url.split('/api/ipc/')[1] ?? '')
      if (channel.includes('get-workspaces')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(workspaces) })
        return
      }
      if (channel.includes('get-sessions')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
        return
      }
      if (channel.includes('get-usage-summary')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(emptyUsage) })
        return
      }
      if (channel.includes('get-app-info')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ name: 'OpenPi', version: '0.2.7', releaseChannel: null }) })
        return
      }
      if (channel.includes('get-first-run') || channel.includes('get-pref') || channel.includes('get-customizations')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(null) })
        return
      }
      if (channel.includes('pick-workspace')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ cancelled: false, path: '/home/andrea/Projects/openpi' }) })
        return
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(null) })
    })

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.homescreen')).toBeVisible({ timeout: 10000 })

    // Call pickWorkspace without arg – should open modal overlay #openpi-workspace-picker
    // Do not await – modal promise resolves only after user closes it
    await page.evaluate(() => {
      void (
        window as unknown as { openpi: { pickWorkspace: () => Promise<unknown> } }
      ).openpi.pickWorkspace()
    })
    await page.waitForTimeout(300)
    const modal = page.locator('#openpi-workspace-picker')
    await expect(modal).toBeVisible()
    await expect(modal.getByText('Open workspace')).toBeVisible()
    await expect(modal.getByText('openpi')).toBeVisible()
    // Close via Cancel
    await modal.getByRole('button', { name: 'Cancel' }).click()
    await expect(modal).not.toBeVisible()
  })
})
