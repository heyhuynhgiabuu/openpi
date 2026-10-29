import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { z } from 'zod'

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
 * as the default. `HIVE_API_KEY` comes from the environment and is never written to disk.
 *
 * This spec therefore calls a real endpoint: it is a manual, local run, never CI.
 *
 * ## Why the token is not in the prompt
 *
 * A turn that fails still stores an assistant message (`stopReason: 'error'`,
 * `pi-durable/dist/harness/generation.js`), and both the composer and the JSONL carry the user's
 * prompt verbatim. Asserting on a token that appears in the prompt would therefore pass with no
 * model answer at all — the mistake `durableGate.spec.ts` avoids with `$(echo MARKER)`. So the model
 * is asked to *assemble* the token from two pieces that never appear joined, and the export is
 * checked structurally: an assistant entry that stopped cleanly and contains the joined token.
 *
 * Guarded by `OPENPI_E2E_DURABLE=1` like the shell-turn spec: the gate is closed in this build, so a
 * run without it would only measure the SDK path.
 */

const provider = 'hive'
const modelId = 'deepseek-ai/deepseek-v4.1-flash-1017'
/** What the UI shows: it renders the model's display name, not its id. */
const modelName = 'DeepSeek 4.1 Flash 1017'
/** Only the model produces this: the prompt supplies the halves separately, never the join. */
const token = 'DURABLE_E2E_OK'
const prompt = "Join 'DURABLE_E2E_' and 'OK' with no separator and reply with only that string."

/** One exported JSONL line, as far as this spec needs to read it. */
const assistantText = z.object({
  type: z.literal('message'),
  message: z.object({
    role: z.literal('assistant'),
    stopReason: z.string(),
    content: z.array(z.object({ type: z.string() }).passthrough()),
  }),
})

const lineSchema = z.object({ type: z.string(), message: z.unknown() }).passthrough()

const userMessage = z.object({
  type: z.literal('message'),
  message: z.object({ role: z.literal('user') }).passthrough(),
})

/** Assistant messages in an exported session, with their stop reason and joined text. */
function assistantTexts(exported: string): { text: string; stopReason: string }[] {
  const out: { text: string; stopReason: string }[] = []
  for (const raw of exported.split('\n')) {
    if (!raw.trim()) continue
    const parsed = lineSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) continue
    const message = assistantText.safeParse(parsed.data)
    if (!message.success) continue
    const text = message.data.message.content
      .map((part) => ('text' in part ? String(part.text) : ''))
      .join('')
    out.push({ text, stopReason: message.data.message.stopReason })
  }
  return out
}

/** Text of the user's own messages in an export, so an echo cannot be mistaken for an answer. */
function userTexts(exported: string): string[] {
  const out: string[] = []
  for (const raw of exported.split('\n')) {
    if (!raw.trim()) continue
    const parsed = lineSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) continue
    const message = userMessage.safeParse(parsed.data)
    if (message.success) out.push(JSON.stringify(message.data.message.content))
  }
  return out
}

/** The developer's `models.json` entry, validated rather than cast. */
const modelsFile = z.object({
  providers: z.record(z.object({ apiKey: z.string().optional() }).passthrough()),
})

test('runs a prompt turn through the model on the durable runtime', async () => {
  test.skip(
    process.env.OPENPI_E2E_DURABLE !== '1',
    'needs the durable gate open (sessionCommands wired); set OPENPI_E2E_DURABLE=1 to run'
  )
  // A real model round-trip on a cold Electron launch.
  test.setTimeout(180_000)
  if (!process.env.HIVE_API_KEY) throw new Error('HIVE_API_KEY must be set for this spec')

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-durable-prompt-'))
  // `os.tmpdir()` is a symlink on macOS and the app authorizes a workspace by real path.
  const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-ws-')))
  const home = path.join(profile, 'home')
  const agentDir = path.join(home, '.pi', 'agent')
  fs.mkdirSync(agentDir, { recursive: true })

  // Sandboxed HOME has no config, so copy the real provider definition and pin it as the default.
  // The key stays an `$HIVE_API_KEY` reference: refuse to copy a literal secret to the sandbox.
  const realModels = path.join(os.homedir(), '.pi', 'agent', 'models.json')
  const parsed = modelsFile.parse(JSON.parse(fs.readFileSync(realModels, 'utf8')))
  const hive = parsed.providers[provider]
  if (!hive) throw new Error(`no ${provider} provider in ${realModels}`)
  if (hive.apiKey?.startsWith('$') === false) {
    throw new Error(`${provider} in ${realModels} has a literal apiKey; refuse to copy a secret`)
  }
  fs.writeFileSync(
    path.join(agentDir, 'models.json'),
    JSON.stringify({ providers: { [provider]: hive } }, null, 2)
  )
  fs.writeFileSync(
    path.join(agentDir, 'settings.json'),
    JSON.stringify({ defaultProvider: provider, defaultModel: modelId }, null, 2)
  )

  const {
    PI_CODING_AGENT_DIR: _agentDir,
    OPENPI_AGENT_DIR: _openpiDir,
    ...inheritedEnv
  } = process.env
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
    expect(await page.evaluate(() => document.body.innerText)).toContain(modelName)

    // The prompt turn: this is what the shell spec cannot cover.
    await composer.fill(prompt)
    await composer.press('Enter')
    await expect(page.locator('.message-list')).toContainText(token, { timeout: 120_000 })

    // Nothing reported the run as unanswered (a model error would log it; see durableSend.ts:50).
    const after = await page.evaluate(() => window.openpi.getOutputBuffer())
    expect(after.filter((line) => line.text.includes('run ended without an answer'))).toEqual([])

    // And it is recorded in durable's own session tree, not just shown in the DOM.
    const sessionsDir = path.join(agentDir, 'sessions')
    const exportedOf = (): string => {
      const dirs = fs.existsSync(sessionsDir)
        ? fs.readdirSync(sessionsDir, { recursive: true, encoding: 'utf8' })
        : []
      const file = dirs.filter((entry) => entry.endsWith('.jsonl'))[0]
      return file ? fs.readFileSync(path.join(sessionsDir, file), 'utf8') : ''
    }
    await expect
      .poll(() => assistantTexts(exportedOf()).length, { timeout: 60_000 })
      .toBeGreaterThan(0)
    const exported = exportedOf()
    expect(JSON.parse(exported.split('\n')[0] ?? '{}')['openpi.durable']).toMatchObject({
      conversationIds: [1],
    })

    // The decisive assertions: an assistant entry that stopped cleanly and carries the token the
    // model assembled. A failed call stops with 'error' and carries no answer.
    const assistant = assistantTexts(exported)
    expect(assistant.filter((entry) => entry.stopReason === 'error')).toEqual([])
    expect(
      assistant.filter((entry) => entry.stopReason === 'stop' && entry.text.includes(token))
    ).not.toHaveLength(0)
    // The user's own words never contain the joined token, so nothing above can pass on an echo.
    expect(userTexts(exported).length).toBeGreaterThan(0)
    expect(userTexts(exported).filter((text) => text.includes(token))).toEqual([])
  } finally {
    await app?.close()
    fs.rmSync(profile, { recursive: true, force: true })
    fs.rmSync(workspace, { recursive: true, force: true })
  }
})
