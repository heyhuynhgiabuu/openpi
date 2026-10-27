/**
 * Shipped-path resume regression (issue #21): a session's active tools survive
 * resume and /tree navigation through the REAL bundled sidecar. Only the model
 * boundary is scripted (tests/fixtures/scripted-provider-extension.js); no
 * network, no model spend.
 *
 * The probe is the fixture's tools prompt: the provider answers with the tool
 * names it was offered on that request, so each assertion reads the active tool
 * set directly instead of inferring it.
 *
 * What the Pi SDK (1.4.0) guarantees, and so what is asserted:
 * - Resume restores the tools the session's transcript recorded (CHANGELOG 1.3.0,
 *   #10785; dist/core/agent-session.js `_restoreToolsFromTranscript`, called from
 *   the constructor when the host passes no explicit `tools`, as OpenPi does; see
 *   `usesDefaultTools` in dist/core/sdk.js). So a resumed session keeps `codemode`
 *   even when `defaultTools` no longer names it: the transcript, not the setting,
 *   decides.
 * - `navigateTree()` re-runs the same restore for the branch it lands on
 *   (agent-session.js `navigateTree`, the `_restoreToolsFromTranscript()` call).
 * - A disabled builtin registers no tool, so nothing can restore it: `-builtin:<name>`
 *   in `extensions` disables a built-in extension (docs/settings.md, "built-in
 *   extensions"; electron/pi/sidecarContext.ts CODEMODE_BUILTIN).
 *
 * Not asserted: a branch whose recorded loadout differs from the live one (no
 * sidecar command activates a tool mid-session), and extension tools that are
 * active by default (CHANGELOG 1.4.0, #11062/#11075): the fixture registers none.
 */
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { SCRIPTED_TOOLS_PROMPT } from './fixtures/scripted-provider-extension.js'
import { startSidecarHarness, type SidecarHarness } from './helpers/shippedSidecarHarness'
import { offeredTools, readSessionTree } from './helpers/shippedTranscript'

// Pi's default active tools (docs/settings.md#tools), sorted like askOfferedTools.
const DEFAULT_TOOLS = ['bash', 'edit', 'read', 'write']
// The documented opt-in (docs/settings.md#tools): adds codemode next to the defaults.
const CODEMODE_OPT_IN: ProjectSettings = { defaultTools: ['+codemode'] }

/** The project settings keys these tests write (docs/settings.md). */
interface ProjectSettings {
  defaultTools?: string[]
  extensions?: string[]
}

/** The running harness; beforeAll sets it, so null here is a harness bug, not a test result. */
function started(harness: SidecarHarness | null): SidecarHarness {
  if (!harness) throw new Error('sidecar harness is not running')
  return harness
}

function writeProjectSettings(h: SidecarHarness, settings: ProjectSettings): void {
  fs.writeFileSync(path.join(h.workspace, '.pi', 'settings.json'), JSON.stringify(settings))
}

/** Starts a new session, or resumes `sessionFile`, on the scripted model. Returns its file. */
async function startScripted(
  h: SidecarHarness,
  requestId: string,
  sessionFile?: string
): Promise<string> {
  const file = await h.startSession(requestId, sessionFile)
  if (!file) throw new Error(`${requestId}: session_ready carried no session file`)
  await h.selectScriptedModel()
  return file
}

/** Runs the tools probe turn and returns the sorted tool names the provider was offered. */
async function askOfferedTools(h: SidecarHarness): Promise<string[]> {
  const before = offeredTools(h.events).length
  await h.prompt(SCRIPTED_TOOLS_PROMPT)
  const answers = offeredTools(h.events)
  expect(answers, 'the provider answers the tools probe exactly once').toHaveLength(before + 1)
  return [...(answers[before] ?? [])].sort()
}

describe('shipped path: codemode opt-in survives resume and tree navigation', () => {
  let harness: SidecarHarness | null = null

  beforeAll(async () => {
    harness = await startSidecarHarness({
      cacheName: 'resume',
      projectSettings: { ...CODEMODE_OPT_IN },
    })
  }, 120_000)

  beforeEach(() => {
    // Each test starts from the opted-in setting; some drop it mid-test.
    writeProjectSettings(started(harness), CODEMODE_OPT_IN)
  })

  afterAll(async () => {
    await harness?.dispose()
    harness = null
  })

  it('offers the same tools, codemode included, after a plain resume', async () => {
    const h = started(harness)
    const file = await startScripted(h, 'plain-start')
    const baseline = await askOfferedTools(h)
    expect(baseline).toEqual(expect.arrayContaining([...DEFAULT_TOOLS, 'codemode']))

    expect(await startScripted(h, 'plain-resume', file)).toBe(file)
    expect(await askOfferedTools(h)).toEqual(baseline)
  }, 120_000)

  it('restores codemode on resume from the session itself once defaultTools stops naming it', async () => {
    const h = started(harness)
    const file = await startScripted(h, 'dropped-start')
    const baseline = await askOfferedTools(h)
    expect(baseline).toContain('codemode')

    // The opt-in is gone. Control: a NEW session under the same settings gets only
    // the defaults, so anything codemode-shaped on resume cannot come from the setting.
    writeProjectSettings(h, {})
    await startScripted(h, 'dropped-control')
    expect(await askOfferedTools(h)).toEqual(DEFAULT_TOOLS)

    expect(await startScripted(h, 'dropped-resume', file)).toBe(file)
    expect(await askOfferedTools(h)).toEqual(baseline)
  }, 120_000)

  it('keeps the active tools when navigate_tree lands on an earlier entry of a resumed session', async () => {
    const h = started(harness)
    const file = await startScripted(h, 'nav-start')
    const baseline = await askOfferedTools(h)
    expect(baseline).toContain('codemode')

    // Resume with the opt-in gone, so the tool set is held by the transcript alone,
    // then add a second turn so the leaf sits past the entry navigated to.
    writeProjectSettings(h, {})
    await startScripted(h, 'nav-resume', file)
    expect(await askOfferedTools(h)).toEqual(baseline)

    const firstAnswerId = readSessionTree(file).find(
      (entry) => entry.type === 'message' && entry.message?.role === 'assistant'
    )?.id
    if (!firstAnswerId) throw new Error('first assistant entry has no id')
    const navigation = await h.navigateTree('nav-tree', firstAnswerId)
    expect(navigation).toEqual({ cancelled: false, leafId: firstAnswerId })

    expect(await askOfferedTools(h)).toEqual(baseline)
    // The probe really ran on the navigated branch: it hangs off the earlier entry.
    const lastUser = readSessionTree(file)
      .filter((entry) => entry.type === 'message' && entry.message?.role === 'user')
      .at(-1)
    expect(lastUser?.parentId).toBe(firstAnswerId)
  }, 120_000)
})

describe('shipped path: a disabled builtin stays off after resume', () => {
  let harness: SidecarHarness | null = null

  beforeAll(async () => {
    // The opt-in is present, but the builtin is disabled in the project setting.
    harness = await startSidecarHarness({
      cacheName: 'resume-builtin-off',
      projectSettings: { extensions: ['-builtin:codemode'], ...CODEMODE_OPT_IN },
    })
  }, 120_000)

  afterAll(async () => {
    await harness?.dispose()
    harness = null
  })

  it('never offers codemode, before or after resume, while -builtin:codemode is set', async () => {
    const h = started(harness)
    const file = await startScripted(h, 'off-start')
    expect(await askOfferedTools(h)).toEqual(DEFAULT_TOOLS)

    expect(await startScripted(h, 'off-resume', file)).toBe(file)
    expect(await askOfferedTools(h)).toEqual(DEFAULT_TOOLS)
  }, 120_000)
})
