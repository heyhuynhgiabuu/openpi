import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

/**
 * The gate condition Phase 8 has been waiting on: a real session, driven through the real renderer,
 * on the durable runtime.
 *
 * Everything here is shipped code — Electron main, the sidecar child, pi-durable's harness, its
 * store, the JSONL export — and the assertions are on what the user sees plus what was written to
 * disk. No model is called: the turn is a shell command, which runs without one.
 *
 * What that covers: preference routing, the cutover decision, harness open, session start, the
 * command path and the export. What it does not: a prompt turn through the model, which is where
 * the agent loop actually runs. That gap is why the gate's own debt list still stands.
 *
 * Two things this pins that unit tests could not:
 *
 * - the runtime preference actually reaches the sidecar through the app's own preference channel and
 *   the gate admits it (a `[runtime] staying on the Pi SDK path` warning would appear in the output
 *   pane if it did not), and
 * - the durable store is created and the session is exported in the SDK's JSONL shape with the
 *   `openpi.durable` stamp, so the sidebar can reopen it.
 *
 * The gate itself is closed in this build (see `WIRED_DURABLE_CAPABILITIES`), so this test only
 * passes with `sessionCommands` wired. That is deliberate: it is the evidence for opening it.
 *
 * The run sandboxes `HOME`, so it seeds one dummy provider key of its own: the shell turn never
 * calls a model, but a session cannot start without one that could. The developer's environment is
 * inherited (its keys and `OPENPI_AGENT_DIR` come along), which is why the seeded key makes the
 * result the same everywhere rather than relying on it.
 */

/**
 * The shell command is typed as `echo DURABLE_E2E_$(echo MARKER)`, so the composer's echo of the
 * command does not contain `DURABLE_E2E_MARKER` literally — only the command's output does. Without
 * that, the message list would match the echoed command and the assertion would pass before the
 * shell had run at all.
 */
const marker = 'DURABLE_E2E_MARKER'
const command = 'echo DURABLE_E2E_$(echo MARKER)'

test('drives a shell turn through the renderer on the durable runtime', async () => {
  test.skip(
    process.env.OPENPI_E2E_DURABLE !== '1',
    'needs the durable gate open (sessionCommands wired); set OPENPI_E2E_DURABLE=1 to run'
  )

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-durable-e2e-'))
  // `os.tmpdir()` is a symlink on macOS; the app authorizes a workspace by real path, so the
  // dialog result must be the resolved one or trust and session start both fail.
  const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-ws-')))
  const home = path.join(profile, 'home')
  fs.mkdirSync(home, { recursive: true })

  test.setTimeout(120_000)
  // `SessionManager.create` honours PI_CODING_AGENT_DIR; inheriting it would put the export outside
  // the sandbox and this test would look in the wrong place.
  const { PI_CODING_AGENT_DIR: _ignoredAgentDir, ...inheritedEnv } = process.env
  // Declared outside `try` so a failed launch still cleans up both directories.
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    app = await electron.launch({
      args: ['.', `--user-data-dir=${path.join(profile, 'user-data')}`],
      env: {
        ...inheritedEnv,
        HOME: home,
        USERPROFILE: home,
        OPENPI_DISABLE_AUTO_UPDATE: '1',
        PI_OFFLINE: '1',
        PI_SKIP_VERSION_CHECK: '1',
        // Self-contained: the sandboxed HOME has no auth.json, and nothing copies the developer's
        // in, so without a key the session would have no model to start with. The turn never calls
        // a model.
        ANTHROPIC_API_KEY: 'openpi-e2e-unused',
      },
    })

    const page = await app.firstWindow()
    await expect(page.locator('#root')).not.toBeEmpty()

    // The real workspace dialog, answered by the harness — the same path a user's click takes.
    await app.evaluate(({ dialog }, target) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] })
    }, workspace)

    // Opt in through the app's own preference channel, before the session starts: that is when the
    // sidecar reads it.
    await page.evaluate(() => window.openpi.setPref('agent.runtime', 'durable'))
    expect(await page.evaluate(() => window.openpi.getPref('agent.runtime'))).toBe('durable')

    await page.evaluate(async () => {
      await window.openpi.pickWorkspace()
    })

    // The composer renders without a session behind it, so this only shows the workspace opened.
    // A session that failed to start surfaces later, as a missing marker — measured: with the
    // fallback reverted, this assertion is where it fails.
    const composer = page.locator('textarea').first()
    await expect(composer).toBeVisible({ timeout: 30_000 })

    // Nothing may have fallen back to the SDK path.
    const output = await page.evaluate(() => window.openpi.getOutputBuffer())
    const fallback = output.filter((line) => line.text.includes('staying on the Pi SDK path'))
    expect(fallback).toEqual([])

    // Shell mode runs without a model, so the turn proves the wiring, not a provider.
    await composer.click()
    await page.keyboard.press('Shift+Meta+X')
    await expect(composer).toHaveAttribute('placeholder', 'Enter shell command…')
    await composer.fill(command)
    await composer.press('Enter')

    // The marker only appears in the command's *output* (see `command` above), so this waits for
    // the shell to have finished rather than for the composer echo.
    await expect(page.locator('.message-list')).toContainText(marker, { timeout: 30_000 })

    // The export is the sidebar's contract: SDK JSONL shape plus the durable stamp.
    const agentDir = path.join(home, '.pi', 'agent')
    expect(fs.existsSync(path.join(agentDir, 'durable'))).toBe(true)
    const sessionsDir = path.join(agentDir, 'sessions')
    const exportedOf = (): string => {
      const dirs = fs.existsSync(sessionsDir)
        ? fs.readdirSync(sessionsDir, { recursive: true, encoding: 'utf8' })
        : []
      const file = dirs.filter((entry) => entry.endsWith('.jsonl'))[0]
      return file ? fs.readFileSync(path.join(sessionsDir, file), 'utf8') : ''
    }
    // A new session writes no file until its first export, so poll the listing and the contents
    // together rather than racing the write.
    await expect.poll(exportedOf, { timeout: 30_000 }).toContain(marker)
    const exported = exportedOf()
    const header = JSON.parse(exported.split('\n')[0] ?? '{}')
    expect(header.type).toBe('session')
    expect(header['openpi.durable']).toMatchObject({ conversationIds: [1] })
    expect(exported).toContain(marker)
  } finally {
    await app?.close()
    fs.rmSync(profile, { recursive: true, force: true })
    fs.rmSync(workspace, { recursive: true, force: true })
  }
})
