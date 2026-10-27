/**
 * Regression guards for the wired MCP and tool-search builtins on the shipped
 * path. Same real sidecar and scripted provider as shippedPathMcp.test.ts, plus
 * the real local stdio MCP fixture server.
 *
 * The probe is stronger than "codemode was not activated": codemode is opted in
 * through `defaultTools` in every case here, so the script runs and fails on the
 * missing MCP tool name. That proves the server was not configured, rather than
 * only that nothing auto-activated codemode.
 */
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  SCRIPTED_MCP_PROMPT,
  SCRIPTED_MCP_TOOL_NAME,
  SCRIPTED_TOOLS_PROMPT,
} from './fixtures/scripted-provider-extension.js'
import { fixtureMcpServer } from './helpers/shippedSidecarBuild'
import { startSidecarHarness, type SidecarHarness } from './helpers/shippedSidecarHarness'
import { answeredText, offeredTools, toolEvents } from './helpers/shippedTranscript'

let markerPath = ''

/** Runs the MCP prompt and returns the codemode call's persisted result text. */
async function runMcpProbe(h: SidecarHarness): Promise<{ isError: boolean; text: string }> {
  await h.startSession('mcp-guard-start')
  await h.selectScriptedModel()
  await h.prompt(SCRIPTED_MCP_PROMPT)
  const starts = toolEvents(h.events).filter(
    (event) => event.type === 'tool_execution_start' && event.toolName === 'codemode'
  )
  expect(starts.length, `codemode never started; answered: ${answeredText(h.events)}`).toBe(1)
  const end = toolEvents(h.events).find(
    (event) => event.type === 'tool_execution_end' && event.toolCallId === 'scripted-mcp-1'
  )
  expect(end).toBeTruthy()
  return { isError: Boolean(end?.isError), text: answeredText(h.events) }
}

/** Asserts the fixture MCP tool never became callable. */
async function expectFixtureServerAbsent(h: SidecarHarness): Promise<void> {
  const result = await runMcpProbe(h)
  expect(result.isError).toBe(true)
  // The codemode script ran and could not resolve the MCP tool, so the server's
  // tools were never registered.
  expect(result.text).toContain(SCRIPTED_MCP_TOOL_NAME)
}

describe('shipped path: no mcp.json means nothing connects', () => {
  let harness: SidecarHarness | null = null

  beforeAll(async () => {
    harness = await startSidecarHarness({ cacheName: 'mcp-guard-no-config' })
  }, 120_000)

  afterAll(async () => {
    await harness?.dispose()
    harness = null
  })

  it('leaves codemode inactive: no server means no auto-activation, so no prompt hang', async () => {
    const h = harness as SidecarHarness
    await h.startSession('mcp-guard-noconfig')
    await h.selectScriptedModel()
    await h.prompt(SCRIPTED_MCP_PROMPT)
    expect(offeredTools(h.events).length).toBe(0)
    const text = answeredText(h.events)
    expect(text).toContain(
      'scripted provider: codemode tool not active (tools: read, bash, edit, write)'
    )
    expect(toolEvents(h.events).some((event) => event.type === 'tool_execution_start')).toBe(false)
  }, 120_000)
})

describe('shipped path: a project server is not read in an untrusted workspace', () => {
  let harness: SidecarHarness | null = null
  // Lives inside the temp workspace, so it is removed with it.
  const markerDir = path.join(process.cwd(), 'node_modules', '.cache', 'openpi-mcp-marker')

  beforeAll(async () => {
    fs.mkdirSync(markerDir, { recursive: true })
    const marker = path.join(markerDir, `untrusted-${process.pid}-${Date.now()}.txt`)
    harness = await startSidecarHarness({
      cacheName: 'mcp-guard-untrusted',
      workspaceTrusted: false,
      providerScope: 'global',
      // A project server exists, would be reachable in a trusted workspace, and
      // writes a marker line the moment it is spawned.
      projectMcp: {
        mcpServers: { fixture: fixtureMcpServer({ env: { MCP_MARKER_FILE: marker } }) },
      },
      // Global settings still apply to an untrusted workspace.
      globalSettings: { defaultTools: ['+codemode'] },
    })
    markerPath = marker
  }, 120_000)

  afterAll(async () => {
    await harness?.dispose()
    harness = null
  })

  it('never launches .pi/mcp.json servers, so its tool is not callable', async () => {
    const h = harness as SidecarHarness
    // The project config really sits where Pi would read it in a trusted workspace.
    expect(fs.existsSync(path.join(h.workspace, '.pi', 'mcp.json'))).toBe(true)
    // An untrusted workspace skips the builtins entirely (`noExtensions`), so
    // codemode is inactive here too — assert that directly instead of probing
    // through it (the fixture answers with the offered-tools diagnostic).
    await h.startSession('mcp-guard-untrusted-start')
    await h.selectScriptedModel()
    await h.prompt(SCRIPTED_MCP_PROMPT)
    expect(answeredText(h.events)).toContain(
      'scripted provider: codemode tool not active (tools: read, bash, edit, write)'
    )
    expect(toolEvents(h.events).some((event) => event.type === 'tool_execution_start')).toBe(false)
    // The strongest evidence: the server process was never spawned.
    expect(fs.existsSync(markerPath)).toBe(false)
    fs.rmSync(markerPath, { force: true })
  }, 120_000)
})

describe('shipped path: -builtin:mcp keeps the MCP extension off', () => {
  let harness: SidecarHarness | null = null

  beforeAll(async () => {
    harness = await startSidecarHarness({
      cacheName: 'mcp-guard-builtin-off',
      projectMcp: { mcpServers: { fixture: fixtureMcpServer() } },
      projectSettings: { extensions: ['-builtin:mcp'], defaultTools: ['+codemode'] },
    })
  }, 120_000)

  afterAll(async () => {
    await harness?.dispose()
    harness = null
  })

  it('never loads the server even though mcp.json configures it', async () => {
    await expectFixtureServerAbsent(harness as SidecarHarness)
  }, 120_000)
})

describe('shipped path: user-level mcp.json always applies to a trusted workspace', () => {
  let harness: SidecarHarness | null = null

  beforeAll(async () => {
    const server = fixtureMcpServer()
    harness = await startSidecarHarness({
      cacheName: 'mcp-global-config',
      // No project mcp.json at all: the server comes from the global agent dir.
      globalMcp: { mcpServers: { fixture: server } },
    })
  }, 120_000)

  afterAll(async () => {
    await harness?.dispose()
    harness = null
  })

  it('connects the user-level server and activates codemode for it', async () => {
    const h = harness as SidecarHarness
    await h.startSession('mcp-global-start')
    await h.selectScriptedModel()
    await h.prompt(SCRIPTED_MCP_PROMPT)
    const nested = toolEvents(h.events).find(
      (event) => event.type === 'tool_execution_end' && event.parentToolCallId === 'scripted-mcp-1'
    )
    expect(nested).toMatchObject({ toolName: SCRIPTED_MCP_TOOL_NAME, isError: false })
  }, 120_000)
})

describe('shipped path: tool-search builtin', () => {
  let on: SidecarHarness | null = null
  let off: SidecarHarness | null = null

  beforeAll(async () => {
    // Both harnesses run in the same beforeAll so the two sidecars start together.
    ;[on, off] = await Promise.all([
      startSidecarHarness({
        cacheName: 'tool-search-on',
        projectSettings: { defaultTools: ['+tool_search'] },
      }),
      startSidecarHarness({
        cacheName: 'tool-search-off',
        projectSettings: {
          defaultTools: ['+tool_search'],
          extensions: ['-builtin:tool-search'],
        },
      }),
    ])
  }, 180_000)

  afterAll(async () => {
    await on?.dispose()
    await off?.dispose()
    on = null
    off = null
  })

  it('offers tool_search when the builtin is enabled, and keeps it off with -builtin:tool-search', async () => {
    const yes = on as SidecarHarness
    await yes.startSession('ts-on')
    await yes.selectScriptedModel()
    await yes.prompt(SCRIPTED_TOOLS_PROMPT)
    expect(offeredTools(yes.events).at(-1) ?? []).toContain('tool_search')

    const no = off as SidecarHarness
    await no.startSession('ts-off')
    await no.selectScriptedModel()
    await no.prompt(SCRIPTED_TOOLS_PROMPT)
    const offered = offeredTools(no.events).at(-1) ?? []
    expect(offered).not.toContain('tool_search')
    // The probe answered from the real tool list, not from an error page.
    expect(offered.length).toBeGreaterThan(0)
  }, 180_000)
})
