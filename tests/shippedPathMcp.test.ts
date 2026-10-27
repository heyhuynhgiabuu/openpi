/**
 * Shipped-path MCP regression: drives the REAL bundled sidecar against a REAL
 * local stdio MCP server (tests/fixtures/mcp-stdio-server.js), with only the
 * model boundary scripted. No network, no OAuth, no extra dependency.
 *
 * What runs for real: the bundled sidecar entry, Pi's built-in `mcp` extension
 * (config load, stdio transport, `initialize` / `tools/list` / `tools/call`),
 * Pi's built-in `codemode` extension, and Pi's tool pipeline for the MCP tool.
 *
 * How the tool is reached: Pi exposes MCP tools with `exposure: "codemode"` by
 * default (dist/extensions/mcp/index.d.ts header), so `mcp__<server>__<tool>` is
 * NOT declared to the model; it is callable from a codemode script, and the MCP
 * extension activates `codemode` for it. The fixture's MCP turn therefore asks
 * for one codemode script that calls the MCP tool — the default route, asserted
 * as such rather than assuming direct exposure.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  SCRIPTED_MCP_FINAL_TEXT,
  SCRIPTED_MCP_PROMPT,
  SCRIPTED_MCP_TOOL_NAME,
  SCRIPTED_MCP_TOOL_TEXT,
  SCRIPTED_SEARCH_PROMPT,
  SCRIPTED_TOOLS_PROMPT,
} from './fixtures/scripted-provider-extension.js'
import { MCP_ECHO_PREFIX, MCP_PI_TOOL_NAME } from './fixtures/mcp-stdio-server.js'
import { fixtureMcpServer } from './helpers/shippedSidecarBuild'
import { startSidecarHarness, type SidecarHarness } from './helpers/shippedSidecarHarness'
import {
  answeredText,
  contentToText,
  offeredTools,
  readSessionTree,
  toolEvents,
} from './helpers/shippedTranscript'

const MCP_CALL_ID = 'scripted-mcp-1'

let harness: SidecarHarness | null = null

beforeAll(async () => {
  harness = await startSidecarHarness({
    cacheName: 'mcp',
    // The server lives in the project config: read only for a trusted workspace.
    projectMcp: { mcpServers: { fixture: fixtureMcpServer() } },
  })
}, 120_000)

afterAll(async () => {
  await harness?.dispose()
  harness = null
})

describe('shipped path: project mcp.json server → codemode → MCP tool', () => {
  it('connects the fixture server, activates codemode for it, and runs its tool', async () => {
    const h = harness as SidecarHarness
    const events = h.events
    const sessionFile = (await h.startSession('mcp-start')) ?? ''
    expect(sessionFile).toBeTruthy()
    await h.selectScriptedModel()

    // Nothing hangs the first prompt: `prompt` resolves on agent_end (the harness
    // times out loudly instead of blocking the suite).
    await h.prompt(SCRIPTED_MCP_PROMPT)

    // ── The default exposure activates codemode rather than declaring the tool ──
    const codemodeStart = toolEvents(events).find(
      (event) => event.type === 'tool_execution_start' && event.toolName === 'codemode'
    )
    expect(
      codemodeStart,
      `codemode never started; provider answered: ${answeredText(events)}`
    ).toBeTruthy()
    expect(codemodeStart?.toolCallId).toBe(MCP_CALL_ID)

    // ── The nested call is a real execution of the MCP tool ─────────────────
    const nestedStart = toolEvents(events).find(
      (event) => event.type === 'tool_execution_start' && event.parentToolCallId === MCP_CALL_ID
    )
    expect(nestedStart?.toolName).toBe(MCP_PI_TOOL_NAME)
    expect(nestedStart?.args).toEqual({ text: SCRIPTED_MCP_TOOL_TEXT })
    const nestedEnd = toolEvents(events).find(
      (event) => event.type === 'tool_execution_end' && event.parentToolCallId === MCP_CALL_ID
    )
    expect(nestedEnd).toMatchObject({ toolName: MCP_PI_TOOL_NAME, isError: false })

    // ── The fixture server really answered: its fixed text reached the record ──
    const codemodeResult = readSessionTree(sessionFile).find(
      (entry) => entry.type === 'message' && entry.message?.toolCallId === MCP_CALL_ID
    )?.message
    expect(codemodeResult?.toolName).toBe('codemode')
    expect(Boolean(codemodeResult?.isError)).toBe(false)
    expect(contentToText(codemodeResult?.content)).toContain(
      `${MCP_ECHO_PREFIX}${SCRIPTED_MCP_TOOL_TEXT}`
    )
    expect(codemodeResult?.nestedCalls).toMatchObject({
      calls: [{ id: `${MCP_CALL_ID}/1`, name: MCP_PI_TOOL_NAME, status: 'ok' }],
      complete: true,
    })
    expect(answeredText(events)).toContain(SCRIPTED_MCP_FINAL_TEXT)

    // The server name in mcp.json is the one Pi spells into the tool name.
    expect(MCP_PI_TOOL_NAME).toBe(SCRIPTED_MCP_TOOL_NAME)
  }, 120_000)

  it('does not declare the MCP tool to the model (default codemode exposure)', async () => {
    const h = harness as SidecarHarness
    await h.prompt(SCRIPTED_TOOLS_PROMPT)
    const last = offeredTools(h.events).at(-1) ?? []
    expect(last).toContain('codemode')
    expect(last).not.toContain(MCP_PI_TOOL_NAME)
  }, 120_000)

  // Regression: disposing a session invalidates the extension runtime of the loader it was
  // built from. The MCP `tool_call` handler calls the captured `pi.getAllTools()`, so a
  // session started from the same (cached) loader had EVERY tool call blocked with "This
  // extension ctx is stale". Each session now gets a fresh loader (stopSession).
  it('still runs the MCP tool in a session that replaced the first one', async () => {
    const h = harness as SidecarHarness
    await h.startSession('mcp-replacement')
    await h.selectScriptedModel()
    const since = h.events.length
    await h.prompt(SCRIPTED_MCP_PROMPT)

    const events = h.events.slice(since)
    const codemodeEnd = toolEvents(events).find(
      (event) => event.type === 'tool_execution_end' && event.toolName === 'codemode'
    )
    expect(codemodeEnd, `provider answered: ${answeredText(events)}`).toMatchObject({
      isError: false,
    })
    expect(answeredText(events)).toContain(SCRIPTED_MCP_FINAL_TEXT)
    expect(answeredText(events)).not.toContain('ctx is stale')
  }, 120_000)
})

describe('shipped path: deferred exposure is found by tool_search and then runs', () => {
  let harness: SidecarHarness | null = null

  beforeAll(async () => {
    harness = await startSidecarHarness({
      cacheName: 'mcp-deferred',
      // Deferred exposure: the tool is hidden from the model until tool_search
      // declares it. tool_search itself needs an opt-in.
      projectMcp: { mcpServers: { fixture: { ...fixtureMcpServer(), exposure: 'deferred' } } },
      projectSettings: { defaultTools: ['+tool_search'] },
    })
  }, 120_000)

  afterAll(async () => {
    await harness?.dispose()
    harness = null
  })

  it('search finds the fixture tool, Pi declares it, and the tool runs', async () => {
    const h = harness as SidecarHarness
    await h.startSession('mcp-deferred-start')
    await h.selectScriptedModel()
    await h.prompt(SCRIPTED_SEARCH_PROMPT)

    const events = h.events
    const searchStart = toolEvents(events).find(
      (event) => event.type === 'tool_execution_start' && event.toolName === 'tool_search'
    )
    expect(searchStart, `provider answered: ${answeredText(events)}`).toBeTruthy()
    const mcpStart = toolEvents(events).find(
      (event) => event.type === 'tool_execution_start' && event.toolName === MCP_PI_TOOL_NAME
    )
    // The model called the MCP tool DIRECTLY (not through codemode): tool_search
    // declared it after the search, which is the deferred route working.
    expect(mcpStart, `provider answered: ${answeredText(events)}`).toBeTruthy()
    expect(Object.hasOwn(mcpStart ?? {}, 'parentToolCallId')).toBe(false)
    const mcpEnd = toolEvents(events).find(
      (event) => event.type === 'tool_execution_end' && event.toolName === MCP_PI_TOOL_NAME
    )
    expect(mcpEnd).toMatchObject({ isError: false })
    expect(answeredText(events)).toContain(
      `scripted search done; declared=true result=${MCP_ECHO_PREFIX}`
    )
  }, 120_000)
})
