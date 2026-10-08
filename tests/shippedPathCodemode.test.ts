/**
 * Shipped-path codemode regression: drives the REAL bundled sidecar with Pi's
 * built-in `codemode` tool, with only the model boundary scripted.
 *
 * What runs for real: the bundled `electron/pi/sidecar.ts` entry, Pi's codemode
 * extension (script runner and `tools.write` bridge), the nested call through
 * the agent loop and Pi's own `write` tool, Pi's JSONL persistence, and the
 * resume path. What is scripted: one provider
 * (`tests/fixtures/scripted-provider-extension.js`) that asks for a codemode
 * script with one nested `write` call. No network, no model spend.
 *
 * Codemode is enabled the documented way: a project `defaultTools: ["+codemode"]`
 * setting. The inactive-without-opt-in guard is in shippedPathCodemodeGuard.test.ts.
 */
import fs from 'node:fs'
import path from 'node:path'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  SCRIPTED_CODEMODE_FILE_CONTENT,
  SCRIPTED_CODEMODE_FILE_PATH,
  SCRIPTED_CODEMODE_FINAL_TEXT,
  SCRIPTED_CODEMODE_PROMPT,
  SCRIPTED_CODEMODE_SCRIPT,
} from './fixtures/scripted-provider-extension.js'
import {
  startSidecarHarness,
  type SidecarHarness,
  type SessionEvent,
} from './helpers/shippedSidecarHarness'
import {
  answeredText,
  contentToText,
  readSessionTree,
  toolEvents,
} from './helpers/shippedTranscript'

// The provider emits this id for the codemode call (see the fixture).
const CODEMODE_CALL_ID = 'scripted-codemode-1'

let harness: SidecarHarness | null = null

beforeAll(async () => {
  harness = await startSidecarHarness({
    cacheName: 'codemode',
    // Enable codemode the documented way: a project setting that adds it to the
    // default tools (Pi's docs: settings.md and cli.md, "Enable codemode").
    projectSettings: { defaultTools: ['+codemode'] },
  })
}, 120_000)

afterAll(async () => {
  await harness?.dispose()
  harness = null
})

describe('shipped path: codemode → nested write → persisted record → resume', () => {
  it('forwards the nested call as events, persists it on the codemode result, and keeps it after resume', async () => {
    const h = harness as SidecarHarness
    const events = h.events
    const sessionFile = (await h.startSession('cm-start')) ?? ''
    expect(sessionFile).toBeTruthy()
    expect(sessionFile.startsWith(h.home)).toBe(true)

    await h.selectScriptedModel()
    await h.prompt(SCRIPTED_CODEMODE_PROMPT)

    // ── Tool card input: the codemode call carries the script as its input ──
    const codemodeStart = toolEvents(events).find(
      (event) => event.type === 'tool_execution_start' && event.toolName === 'codemode'
    )
    // Failure detail: what the provider actually answered with (empty when it
    // never reached a codemode call).
    expect(
      codemodeStart,
      `codemode tool never started; provider answered: ${answeredText(events)}`
    ).toBeTruthy()
    expect(codemodeStart?.toolCallId).toBe(CODEMODE_CALL_ID)
    expect(codemodeStart?.args).toEqual({ code: SCRIPTED_CODEMODE_SCRIPT })

    // ── Nested forwarding: the script's tools.write call is a real child event ──
    const nestedStart = toolEvents(events).find(
      (event) =>
        event.type === 'tool_execution_start' && event.parentToolCallId === CODEMODE_CALL_ID
    )
    expect(nestedStart).toMatchObject({
      toolName: 'write',
      toolCallId: `${CODEMODE_CALL_ID}/1`,
      args: { path: SCRIPTED_CODEMODE_FILE_PATH, content: SCRIPTED_CODEMODE_FILE_CONTENT },
    })
    const nestedEnd = toolEvents(events).find(
      (event) => event.type === 'tool_execution_end' && event.parentToolCallId === CODEMODE_CALL_ID
    )
    expect(nestedEnd).toMatchObject({
      toolName: 'write',
      toolCallId: `${CODEMODE_CALL_ID}/1`,
      isError: false,
    })
    const codemodeEnd = toolEvents(events).find(
      (event) => event.type === 'tool_execution_end' && event.toolCallId === CODEMODE_CALL_ID
    )
    expect(codemodeEnd?.isError).toBe(false)
    // Nested start → end sit between the codemode start and end, in order.
    const order = [codemodeStart, nestedStart, nestedEnd, codemodeEnd].map((event) =>
      events.indexOf(event as SessionEvent)
    )
    expect(order.every((index) => index !== -1)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)

    // ── The world: the nested write really ran through Pi's write tool ──────
    expect(fs.readFileSync(path.join(h.workspace, SCRIPTED_CODEMODE_FILE_PATH), 'utf8')).toBe(
      SCRIPTED_CODEMODE_FILE_CONTENT
    )

    // ── The truth: Pi's JSONL holds the codemode result with its nested record ─
    const tree = readSessionTree(sessionFile)
    const codemodeResult = tree.find(
      (entry) =>
        entry.type === 'message' &&
        entry.message?.role === 'toolResult' &&
        entry.message?.toolCallId === CODEMODE_CALL_ID
    )?.message
    expect(codemodeResult?.toolName).toBe('codemode')
    expect(Boolean(codemodeResult?.isError)).toBe(false)
    expect(contentToText(codemodeResult?.content)).toContain('Script completed')
    // The nested record: name, arguments, and status; results are never stored.
    expect(codemodeResult?.nestedCalls).toMatchObject({
      calls: [
        {
          id: `${CODEMODE_CALL_ID}/1`,
          name: 'write',
          status: 'ok',
          arguments: { path: SCRIPTED_CODEMODE_FILE_PATH, content: SCRIPTED_CODEMODE_FILE_CONTENT },
        },
      ],
      complete: true,
    })
    // Documented contract: nested ids never appear as transcript tool calls/results.
    expect(tree.some((entry) => entry.message?.toolCallId === `${CODEMODE_CALL_ID}/1`)).toBe(false)

    // ── Resume: a fresh sidecar session rebuilds the same history from disk ──
    const resumedFile = await h.startSession('cm-resume', sessionFile)
    expect(resumedFile).toBe(sessionFile)
    const info = await h.sessionInfo('cm-info')
    // Every persisted message entry (system, user, assistant call, codemode result, final
    // assistant text) is rebuilt on resume.
    const persistedMessages = tree.filter((entry) => entry.type === 'message').length
    expect(info.messageCount).toBe(persistedMessages)
    expect(persistedMessages).toBeGreaterThanOrEqual(4)

    // Pi's own reload read path (the one a resumed session uses) keeps the record.
    const reloaded = SessionManager.open(sessionFile, undefined, h.workspace).buildSessionContext()
    const reloadedResult = reloaded.messages.find(
      (message) =>
        message.role === 'toolResult' &&
        'toolCallId' in message &&
        message.toolCallId === CODEMODE_CALL_ID
    ) as unknown as { nestedCalls?: { calls?: Array<{ id: string; status: string }> } } | undefined
    expect(reloadedResult?.nestedCalls?.calls).toMatchObject([
      { id: `${CODEMODE_CALL_ID}/1`, name: 'write', status: 'ok' },
    ])
    const lastMessage = reloaded.messages.at(-1)
    expect(
      contentToText(lastMessage && 'content' in lastMessage ? lastMessage.content : undefined)
    ).toBe(SCRIPTED_CODEMODE_FINAL_TEXT)
  }, 120_000)
})
