import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

/**
 * Gate condition 3: a **prompt turn through the model** on the durable runtime, driven through the
 * real renderer.
 *
 * The shell-turn spec next door (`durableGate.spec.ts`) covers preference routing, harness open, the
 * command path and the export, but never enters the agent loop. This one does: a prompt is typed
 * into the composer, a real model answers, and the answer is asserted on screen and in the export.
 *
 * ## The model
 *
 * `electron/pi/durable/extensionCompat.ts:44` classifies `registerProvider` as unsupported on the
 * durable runtime, so the project-extension trick the `shippedPath*` suites use on the SDK path
 * cannot register a provider here, and production `durableHost.ts` never passes `registerProviders`
 * (that seam is for unit tests). The supported route is a provider declared in `models.json` over a
 * compatible endpoint, so the sandbox gets a copy of the `hive` provider and `settings.json` pins it
 * as the default. `HIVE_API_KEY` comes from the environment.
 *
 * This spec therefore calls a real endpoint: it is a manual, local run, never CI.
 *
 * Guarded by `OPENPI_E2E_DURABLE=1` like the shell-turn spec: the gate is closed in this build, so a
 * run without it would only measure the SDK path.
 */

const provider = 'hive'
const modelId = 'deepseek-ai/deepseek-v4.1-flash-1017'
/** The model is asked to echo this, so the assertion does not depend on prose. */
const token = 'DURABLE_E2E_OK'
const prompt = `Reply with exactly this token and nothing else: ${token}`

test('runs a prompt turn through the model on the durable runtime', async () => {
  test.skip(
    process.env.OPENPI_E2E_DURABLE !== '1',
    'needs the durable gate open (sessionCommands wired); set OPENPI_E2E_DURABLE=1 to run'
  )
  // A real model round-trip on a cold Electron launch.
  test.setTimeout(180_000)

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-durable-prompt-'))
  // `os.tmpdir()` is a symlink on macOS and the app authorizes a workspace by real path.
  const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-ws-')))
  const home = path.join(profile, 'home')
  const agentDir = path.join(home, '.pi', 'agent')
  fs.mkdirSync(agentDir, { recursive: true })

  // Sandboxed HOME has no config, so copy the real provider definition and pin it as the default.
  // The key stays in the environment (`$HIVE_API_KEY`), never written to disk.
  const realModels = path.join(os.homedir(), '.pi', 'agent', 'models.json')
  const parsed = JSON.parse(fs.readFileSync(realModels, 'utf8')) as {
    providers: Record<string, unknown>
  }
  const hive = parsed.providers[provider]
  if (!hive) throw new Error(`no ${provider} provider in ${realModels}`)
  fs.writeFileSync(
    path.join(agentDir, 'models.json'),
    JSON.stringify({ providers: { [provider]: hive } }, null, 2)
  )
  fs.writeFileSync(
    path.join(agentDir, 'settings.json'),
    JSON.stringify({ defaultProvider: provider, defaultModel: modelId }, null, 2)
  )

  const { PI_CODING_AGENT_DIR: _ignoredAgentDir, ...inheritedEnv } = process.env
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    app = await electron.launch({
      args: ['.', `--user-data-dir=${path.join(profile, 'user-data')}`],
      env: {
        ...inheritedEnv,
        HOME: home,
        USERPROFILE: home,
        OPENPI_DISABLE_AUTO_UPDATE: '1',
        PI_SKIP_VERSION_CHECK: '1',
      },
    })

    const page = await app.firstWindow()
    await expect(page.locator('#root')).not.toBeEmpty()

    await app.evaluate(({ dialog }, target) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] })
    }, workspace)

    await page.evaluate(() => window.openpi.setPref('agent.runtime', 'durable'))
    await page.evaluate(async () => {
      await window.openpi.pickWorkspace()
    })

    const composer = page.locator('textarea').first()
    await expect(composer).toBeVisible({ timeout: 60_000 })

    // Nothing may have fallen back to the SDK path, and the pinned model must be the one in use.
    const output = await page.evaluate(() => window.openpi.getOutputBuffer())
    expect(output.filter((line) => line.text.includes('staying on the Pi SDK path'))).toEqual([])
    expect(await page.evaluate(() => document.body.innerText)).toContain('DeepSeek')

    // The prompt turn: this is what the shell spec cannot cover.
    await composer.fill(prompt)
    await composer.press('Enter')
    await expect(page.locator('.message-list')).toContainText(token, { timeout: 120_000 })

    // And it is recorded in durable's own session tree, not just shown in the DOM.
    const sessionsDir = path.join(agentDir, 'sessions')
    const exportedOf = (): string => {
      const dirs = fs.existsSync(sessionsDir)
        ? fs.readdirSync(sessionsDir, { recursive: true, encoding: 'utf8' })
        : []
      const file = dirs.filter((entry) => entry.endsWith('.jsonl'))[0]
      return file ? fs.readFileSync(path.join(sessionsDir, file), 'utf8') : ''
    }
    await expect.poll(exportedOf, { timeout: 60_000 }).toContain(token)
    const exported = exportedOf()
    expect(JSON.parse(exported.split('\n')[0] ?? '{}')['openpi.durable']).toMatchObject({
      conversationIds: [1],
    })
    // The user's prompt reached the model and the answer came back through the agent loop.
    expect(exported).toContain(token)
    expect(exported).toContain('assistant')
  } finally {
    await app?.close()
    fs.rmSync(profile, { recursive: true, force: true })
    fs.rmSync(workspace, { recursive: true, force: true })
  }
})
