/**
 * Shipped-path abort regression (issue #20): `abort` mid-turn through the REAL
 * bundled sidecar ends the run as aborted, and the sidecar bridge forwards
 * `agent_settled` with its `aborted` flag intact. Only the model boundary is
 * scripted (tests/fixtures/scripted-hold-extension.js): its provider stream and
 * its tool stay parked until released or aborted, so abort lands mid-turn
 * without a sleep.
 *
 * What the Pi SDK (1.4.0) promises, and so what is asserted:
 * - `agent_settled` carries `aborted`: `true` when the run ended because it was
 *   aborted (CHANGELOG 1.1.0, #10607; docs/json.md event table; dist/core/
 *   agent-session.js `_emitAgentSettled`, which reads `_agentRunAbortRequested`
 *   that `abort()` sets while a run is active). The wire shape is exactly
 *   `{ type: 'agent_settled', aborted }`.
 * - `agent_end` closes the low-level run and `agent_settled` follows it
 *   (docs/json.md "Event sequence"); an aborted run is never retried
 *   (`_willRetryAfterAgentEnd`: no retry once an abort was requested).
 * - The abort flag belongs to one run: `_startRun` resets it, so the next run
 *   settles with `aborted: false`.
 *
 * Not asserted: what the provider returns on abort (a provider contract, not
 * Pi's), and what happens to queued steer/follow-up text on abort (the SDK
 * makes no promise; see the report).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  HOLD_PLAIN_PROMPT,
  HOLD_STREAM_PROMPT,
  HOLD_TOOL_NAME,
  HOLD_TOOL_PROMPT,
} from './fixtures/scripted-hold-extension.js'
import { awaitSettled, startHeldSession, startHoldHarness, started } from './helpers/shippedHold'
import {
  expectInOrder,
  isAssistantStart,
  isEvent,
  isToolStart,
  runLog,
} from './helpers/shippedRunLog'
import type { SidecarHarness } from './helpers/shippedSidecarHarness'

describe('shipped path: abort and agent_settled.aborted', () => {
  let harness: SidecarHarness | null = null

  beforeAll(async () => {
    harness = await startHoldHarness('abort')
  }, 120_000)

  afterAll(async () => {
    await harness?.dispose()
    harness = null
  })

  it('reports a finished run as agent_settled aborted=false', async () => {
    const h = started(harness)
    await startHeldSession(h, 'finished-start')
    const since = h.events.length
    h.startPrompt(HOLD_PLAIN_PROMPT)

    expect(await awaitSettled(h, since)).toEqual({ type: 'agent_settled', aborted: false })
    const log = runLog(h.events, since)
    expectInOrder(log, ['agent_start', 'agent_end', 'agent_settled aborted=false'])
  }, 60_000)

  it('settles an abort issued while the model stream is open with aborted=true', async () => {
    const h = started(harness)
    await startHeldSession(h, 'stream-start')
    const since = h.events.length
    h.startPrompt(HOLD_STREAM_PROMPT)
    await h.waitForEvent(isAssistantStart, since) // the provider call is open and parked

    h.abort()
    const settled = await awaitSettled(h, since)

    // The bridge forwards the flag untouched and reshapes nothing.
    expect(settled).toEqual({ type: 'agent_settled', aborted: true })
    const log = runLog(h.events, since)
    expectInOrder(log, [
      'agent_start',
      `user: ${HOLD_STREAM_PROMPT}`,
      'assistant_start',
      'assistant[aborted]: ',
      'agent_end',
      'agent_settled aborted=true',
    ])
    expect(log.at(-1), 'agent_settled is the last thing the run reports').toBe(
      'agent_settled aborted=true'
    )
    const agentEnd = h.events.slice(since).find(isEvent('agent_end'))
    expect(agentEnd?.willRetry, 'an aborted run is not retried').toBe(false)
  }, 60_000)

  it('settles an abort issued while a tool is running with aborted=true', async () => {
    const h = started(harness)
    await startHeldSession(h, 'tool-start')
    const since = h.events.length
    h.startPrompt(HOLD_TOOL_PROMPT)
    await h.waitForEvent(isToolStart(HOLD_TOOL_NAME), since) // the tool is parked

    h.abort()
    const settled = await awaitSettled(h, since)

    expect(settled).toEqual({ type: 'agent_settled', aborted: true })
    const log = runLog(h.events, since)
    expectInOrder(log, [
      `tool_start ${HOLD_TOOL_NAME}`,
      `tool_end ${HOLD_TOOL_NAME} error`,
      'agent_end',
      'agent_settled aborted=true',
    ])
    // The scripted model would answer once the tool returned; an aborted run never gets there.
    expect(log.filter((entry) => entry.startsWith('assistant[stop]'))).toEqual([])
  }, 60_000)

  it('does not carry aborted over to the next run', async () => {
    const h = started(harness)
    await startHeldSession(h, 'next-run-start')
    const aborted = h.events.length
    h.startPrompt(HOLD_STREAM_PROMPT)
    await h.waitForEvent(isAssistantStart, aborted)
    h.abort()
    expect((await awaitSettled(h, aborted)).aborted).toBe(true)

    const next = h.events.length
    h.startPrompt(HOLD_PLAIN_PROMPT)
    expect(await awaitSettled(h, next)).toEqual({ type: 'agent_settled', aborted: false })
  }, 60_000)
})
