/**
 * Regression guard: codemode must stay inactive on the shipped path unless it is
 * opted in through `defaultTools`, and `-builtin:codemode` must keep it off even
 * with the opt-in present. Same real sidecar and scripted provider as
 * shippedPathCodemode.test.ts; the provider's codemode prompt is the probe.
 *
 * Without an active codemode tool the fixture answers with a diagnostic that
 * lists the tools it was offered, so the assertions read the active tool set
 * directly instead of inferring it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SCRIPTED_CODEMODE_PROMPT } from './fixtures/scripted-provider-extension.js'
import { startSidecarHarness, type SidecarHarness } from './helpers/shippedSidecarHarness'
import { answeredText, toolEvents } from './helpers/shippedTranscript'

// The default active set: codemode is absent from the list the provider sees.
const DEFAULT_TOOLS_DIAGNOSTIC =
  'scripted provider: codemode tool not active (tools: read, bash, edit, write)'

/** Runs the codemode prompt and asserts codemode never started and was not offered. */
async function expectCodemodeInactive(h: SidecarHarness): Promise<void> {
  await h.startSession('guard-start')
  await h.selectScriptedModel()
  await h.prompt(SCRIPTED_CODEMODE_PROMPT)

  const codemodeStarts = toolEvents(h.events).filter(
    (event) => event.type === 'tool_execution_start' && event.toolName === 'codemode'
  )
  expect(codemodeStarts).toEqual([])
  expect(answeredText(h.events)).toContain(DEFAULT_TOOLS_DIAGNOSTIC)
}

describe('shipped path: codemode stays inactive without an opt-in', () => {
  let harness: SidecarHarness | null = null

  beforeAll(async () => {
    // No project settings: no defaultTools opt-in anywhere.
    harness = await startSidecarHarness({ cacheName: 'codemode-guard-no-optin' })
  }, 120_000)

  afterAll(async () => {
    await harness?.dispose()
    harness = null
  })

  it('does not start or offer codemode when defaultTools does not name it', async () => {
    await expectCodemodeInactive(harness as SidecarHarness)
  }, 120_000)
})

describe('shipped path: untrusted workspace keeps the codemode builtin off', () => {
  let harness: SidecarHarness | null = null

  beforeAll(async () => {
    // Untrusted: project extensions and builtins are skipped (noExtensions), so the
    // provider comes from the global agent dir. The opt-in is in global settings,
    // which an untrusted workspace still reads.
    harness = await startSidecarHarness({
      cacheName: 'codemode-guard-untrusted',
      workspaceTrusted: false,
      providerScope: 'global',
      globalSettings: { defaultTools: ['+codemode'] },
    })
  }, 120_000)

  afterAll(async () => {
    await harness?.dispose()
    harness = null
  })

  it('does not start or offer codemode in an untrusted workspace, even with a global opt-in', async () => {
    await expectCodemodeInactive(harness as SidecarHarness)
  }, 120_000)
})

describe('shipped path: -builtin:codemode keeps codemode off even with the opt-in', () => {
  let harness: SidecarHarness | null = null

  beforeAll(async () => {
    // The opt-in is present, but the builtin is disabled in the project setting.
    harness = await startSidecarHarness({
      cacheName: 'codemode-guard-builtin-off',
      projectSettings: { extensions: ['-builtin:codemode'], defaultTools: ['+codemode'] },
    })
  }, 120_000)

  afterAll(async () => {
    await harness?.dispose()
    harness = null
  })

  it('does not start or offer codemode when the builtin is disabled', async () => {
    await expectCodemodeInactive(harness as SidecarHarness)
  }, 120_000)
})
