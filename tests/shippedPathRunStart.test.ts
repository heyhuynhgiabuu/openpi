/**
 * Shipped-path run-start regression (issue #20): what `prompt`, `steer`,
 * `abort` and extension messages do while a run is STARTING (before the first
 * model call) through the REAL bundled sidecar. The hold extension
 * (tests/fixtures/scripted-hold-extension.js) parks its `before_agent_start`
 * handler for the start prompts until released, and announces the park through
 * `ctx.ui.notify`, which the sidecar forwards as a custom message, so every
 * command here is sent at a point the test has observed, not slept into.
 *
 * What the Pi SDK (1.4.0) promises, and so what is asserted (CHANGELOG 1.2.0,
 * #10739; docs/extensions.md "Events and concurrency"; dist/core/agent-session.js
 * `_startRun`, which sets `_isAgentRunActive` before `before_agent_start` runs):
 * - The session counts as busy while a run starts: `ctx.isIdle()` is false in
 *   `before_agent_start`, and a second `prompt` (the sidecar passes no
 *   streamingBehavior) is rejected instead of starting a second run (`prompt()`
 *   throws "Agent is already processing" while `isStreaming`).
 * - `steer()` and `pi.sendMessage()` during the start queue into the starting
 *   run: one run, one `agent_settled`, no "already processing" failure.
 * - An abort requested during the start aborts the run once it starts
 *   (`_handleAgentEvent` calls `agent.abort()` on `agent_start` when
 *   `_agentRunAbortRequested`), and the run settles with `aborted: true`.
 *
 * Not asserted: that a start-time steer reaches the FIRST model call. The SDK
 * promises it joins the starting run; its place inside the run is Pi's detail.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  HOLD_NOTE_TEXT,
  HOLD_NOTIFY_PREFIX,
  HOLD_PLAIN_PROMPT,
  HOLD_START_PROMPT,
  HOLD_START_SEND_PROMPT,
} from './fixtures/scripted-hold-extension.js'
import { awaitSettled, startHeldSession, startHoldHarness, started } from './helpers/shippedHold'
import { countOf, expectInOrder, isCustomMessage, isEvent, runLog } from './helpers/shippedRunLog'
import type { SidecarHarness } from './helpers/shippedSidecarHarness'

const STEER_TEXT = 'steer: while starting'
const PARKED_NOTICE = `custom: ${HOLD_NOTIFY_PREFIX}false`

/** Sends `prompt` and waits until its run is parked in before_agent_start. Returns the log index it started at. */
async function parkRunStart(h: SidecarHarness, prompt: string): Promise<number> {
  const since = h.events.length
  h.startPrompt(prompt)
  await h.waitForEvent(isCustomMessage(HOLD_NOTIFY_PREFIX), since)
  return since
}

describe('shipped path: commands while a run is starting', () => {
  let harness: SidecarHarness | null = null

  beforeAll(async () => {
    harness = await startHoldHarness('run-start')
  }, 120_000)

  afterAll(async () => {
    await harness?.dispose()
    harness = null
  })

  it('counts the session as busy: ctx.isIdle() is false and a second prompt is rejected', async () => {
    const h = started(harness)
    await startHeldSession(h, 'busy-start')
    const since = await parkRunStart(h, HOLD_START_PROMPT)

    // Parked before the run exists: no agent_start yet, and the handler saw a busy session.
    expect(runLog(h.events, since)).toContain(PARKED_NOTICE)
    expect(runLog(h.events, since)).not.toContain('agent_start')

    const errorsBefore = h.errors.length
    h.startPrompt(HOLD_PLAIN_PROMPT)
    const rejection = await h.waitForError(errorsBefore)
    expect(rejection.message).toMatch(/already processing/i)

    h.release('start')
    await awaitSettled(h, since)
    const log = runLog(h.events, since)
    expect(countOf(log, 'agent_start'), 'the rejected prompt started no second run').toBe(1)
    expect(log.filter((entry) => entry.startsWith('user: '))).toEqual([
      `user: ${HOLD_START_PROMPT}`,
    ])
    expect(log.at(-1)).toBe('agent_settled aborted=false')
  }, 60_000)

  it('queues a steer sent during the start into the starting run', async () => {
    const h = started(harness)
    await startHeldSession(h, 'steer-start')
    const since = await parkRunStart(h, HOLD_START_PROMPT)

    h.steer(STEER_TEXT)
    // Pi reports the queued steer even though no run exists yet.
    await h.waitForEvent(
      (event) => runLog([event])[0] === `queue steer=["${STEER_TEXT}"] followUp=[]`,
      since
    )
    expect(runLog(h.events, since)).not.toContain('agent_start')

    h.release('start')
    await awaitSettled(h, since)

    const log = runLog(h.events, since)
    expectInOrder(log, [
      `queue steer=["${STEER_TEXT}"] followUp=[]`,
      'agent_start',
      'queue steer=[] followUp=[]',
      `user: ${STEER_TEXT}`,
      'agent_end',
      'agent_settled aborted=false',
    ])
    expectInOrder(log, ['agent_start', `user: ${HOLD_START_PROMPT}`, 'agent_end'])
    expect(countOf(log, 'agent_start'), 'the steer joined the starting run').toBe(1)
    expect(countOf(log, 'agent_settled aborted=false')).toBe(1)
  }, 60_000)

  it('aborts the run once it starts when abort was requested during the start', async () => {
    const h = started(harness)
    await startHeldSession(h, 'abort-start')
    const since = await parkRunStart(h, HOLD_START_PROMPT)

    h.abort()
    // Barrier: the sidecar handles commands in order, so once this reply is back
    // the abort has been handled. Nothing has started or settled yet.
    await h.sessionInfo('abort-barrier')
    expect(runLog(h.events, since)).not.toContain('agent_start')
    expect(h.events.slice(since).some(isEvent('agent_settled'))).toBe(false)

    h.release('start')
    const settled = await awaitSettled(h, since)

    expect(settled).toEqual({ type: 'agent_settled', aborted: true })
    const log = runLog(h.events, since)
    expectInOrder(log, ['agent_start', 'agent_end', 'agent_settled aborted=true'])
    // The scripted model answers any prompt it is given; the aborted run never completes that answer.
    expect(log.filter((entry) => entry.startsWith('assistant[stop]'))).toEqual([])

    // The abort belonged to that run: the next one is a normal run.
    const next = h.events.length
    h.startPrompt(HOLD_PLAIN_PROMPT)
    expect(await awaitSettled(h, next)).toEqual({ type: 'agent_settled', aborted: false })
  }, 60_000)
})

/**
 * Own sidecar, and only ONE session in it: the extension calls `pi.sendMessage`
 * through the `pi` its factory captured, and OpenPi's sidecar reuses one
 * resource loader across sessions (sidecarContext.ts `getResourceLoader`). After
 * the first session is replaced that captured `pi` is stale and every
 * `pi.sendMessage` throws "This extension ctx is stale after session replacement
 * or reload", which OpenPi filters out of the event stream (sessionLifecycle.ts
 * `onError`, eventBridge `isStaleExtensionCtxEvent`). So this behavior is only
 * reachable in a sidecar's first session; see the report.
 */
describe('shipped path: pi.sendMessage while a run is starting (first session only)', () => {
  let harness: SidecarHarness | null = null

  beforeAll(async () => {
    harness = await startHoldHarness('run-start-message')
  }, 120_000)

  afterAll(async () => {
    await harness?.dispose()
    harness = null
  })

  it('queues pi.sendMessage from before_agent_start into the starting run', async () => {
    const h = started(harness)
    await startHeldSession(h, 'send-message-start')
    const since = await parkRunStart(h, HOLD_START_SEND_PROMPT)
    h.release('start')
    await awaitSettled(h, since)

    const log = runLog(h.events, since)
    expectInOrder(log, ['agent_start', `custom: ${HOLD_NOTE_TEXT}`, 'agent_end'])
    expect(countOf(log, 'agent_start')).toBe(1)
    // Before 1.2.0 this started a second run that failed with "Agent is already processing".
    expect(h.events.slice(since).filter(isEvent('extension_error'))).toEqual([])
  }, 60_000)
})
