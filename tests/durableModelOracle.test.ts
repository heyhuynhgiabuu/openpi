import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentSession, ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chooseDurableModel } from '../electron/pi/durableModel'

/**
 * Cutover gate item 7: the durable runtime resolves the model itself (`chooseDurableModel`) instead
 * of letting the SDK do it (`findInitialModel`). The SDK has a step this cannot reproduce — a
 * per-provider default-model table that is not exported from the package — so the two can disagree
 * when no usable default is stored.
 *
 * The SDK's own public entry is the oracle here rather than a copy of that table, which would drift
 * silently on every SDK bump. These tests pin what the divergence IS, so closing it fails here and
 * forces item 7 to be updated instead of quietly going stale.
 *
 * Hermetic: credentials come from a temp `auth.json`, there is no network, and the ambient provider
 * keys are stripped — with them set, unrelated providers report credentials and the oracle's answer
 * would depend on the machine.
 */

/**
 * Anything pi-ai can read a credential from. `*_API_KEY`/`*_TOKEN` covers most providers, but Bedrock
 * counts as configured from `AWS_*` and Vertex from `GOOGLE_CLOUD_*`/`GOOGLE_APPLICATION_CREDENTIALS`,
 * so leaving those set made the oracle's answer depend on the machine (measured: with AWS_PROFILE the
 * first available model became `amazon-bedrock/…`, and bedrock is first in the SDK's table).
 */
const PROVIDER_ENV =
  /^(?:[A-Z0-9_]+_(?:API_KEY|TOKEN)|ANTHROPIC_OAUTH_TOKEN|AWS_.*|GOOGLE_CLOUD_.*|GOOGLE_APPLICATION_CREDENTIALS|GCLOUD_PROJECT)$/
const savedEnv: Record<string, string | undefined> = {}
const dirs: string[] = []

beforeAll(() => {
  for (const key of Object.keys(process.env)) {
    const value = process.env[key]
    if (value !== undefined && PROVIDER_ENV.test(key)) {
      savedEnv[key] = value
      delete process.env[key]
    }
  }
})

afterAll(async () => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value !== undefined) process.env[key] = value
  }
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

/**
 * A fresh agent dir with credentials for two providers, plus an optional stored default. The SDK
 * reads the stored default from `settings.json` here, so `chooseDurableModel` must be handed the
 * same pair or the comparison is meaningless.
 */
async function agentDir(settings: Record<string, string> = {}): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'openpi-model-oracle-'))
  dirs.push(home)
  await writeFile(
    join(home, 'auth.json'),
    JSON.stringify({
      anthropic: { type: 'api_key', key: 'test' },
      openai: { type: 'api_key', key: 'test' },
    })
  )
  if (Object.keys(settings).length > 0) {
    await writeFile(join(home, 'settings.json'), JSON.stringify(settings))
  }
  return home
}

async function runtime(home: string): Promise<ModelRuntime> {
  return ModelRuntime.create({
    authPath: join(home, 'auth.json'),
    modelsPath: join(home, 'models.json'),
    // Without this the availability snapshot stays empty and every path resolves differently.
    refreshOnCreate: true,
  })
}

/** What the SDK itself would choose, via its public session factory. */
async function sdkChoice(home: string, models: ModelRuntime): Promise<string | undefined> {
  const { session } = await createAgentSession({
    agentDir: home,
    cwd: home,
    modelRuntime: models,
    sessionManager: SessionManager.inMemory(home),
  })
  const choice = `${session.model?.provider}/${session.model?.id}`
  session.dispose()
  return choice
}

describe('durable model choice against the SDK oracle (#37 item 7)', () => {
  it('agrees with the SDK when a usable default is stored', async () => {
    // Deliberately not `gpt-5.5`, which is openai's table default. A reviewer measured that with
    // this two-provider fixture, an SDK ignoring `settings.json` picks anthropic either way, so
    // `gpt-5.5` was not vacuous outright — but it could not catch the narrower case where the SDK
    // keeps the stored provider and substitutes that provider's table default. `o4-mini` does.
    const stored = { defaultProvider: 'openai', defaultModel: 'o4-mini' }
    const home = await agentDir(stored)
    const models = await runtime(home)

    // Precondition: if the fixture model leaves the SDK catalog, say so plainly rather than
    // letting the assertion below report a confusing model mismatch.
    expect(
      models.getModel(stored.defaultProvider, stored.defaultModel),
      'fixture model missing from SDK catalog'
    ).toBeDefined()

    const choice = chooseDurableModel(
      {
        getDefaultProvider: () => stored.defaultProvider,
        getDefaultModel: () => stored.defaultModel,
      },
      models
    )

    expect(`${choice?.provider}/${choice?.modelId}`).toBe(await sdkChoice(home, models))
    expect(choice?.fallback).toBe(false)
  })

  it('picks the first available model, where the SDK picks its per-provider default', async () => {
    const home = await agentDir()
    const models = await runtime(home)
    const firstAvailable = models.getAvailableSnapshot()[0]

    const choice = chooseDurableModel(
      { getDefaultProvider: () => undefined, getDefaultModel: () => undefined },
      models
    )

    // Durable side: list order, flagged as a fallback.
    expect(`${choice?.provider}/${choice?.modelId}`).toBe(
      `${firstAvailable?.provider}/${firstAvailable?.id}`
    )
    expect(choice?.fallback).toBe(true)

    // The divergence, stated as one fact. Both sides can land on the same provider, so what
    // separates them is the model — in SDK 1.4.0 the snapshot lists anthropic's first model while
    // the SDK prefers its table default. Two different failures mean two different things:
    //   - the assertion above fails → `chooseDurableModel` changed; check whether the gap closed.
    //   - this assertion fails → the fixture no longer demonstrates the gap (likely an SDK catalog
    //     change, e.g. the table default now being the first listed model). Re-check against the
    //     SDK before touching ROADMAP item 7; the gap may still exist for other providers.
    expect(await sdkChoice(home, models)).not.toBe(`${choice?.provider}/${choice?.modelId}`)
  })
})
