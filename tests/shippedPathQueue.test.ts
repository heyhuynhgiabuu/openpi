/**
 * Shipped-path steer / follow-up regression (issue #20), mid-turn, through the
 * REAL bundled sidecar. Only the model boundary is scripted
 * (tests/fixtures/scripted-hold-extension.js): the first model call asks for a
 * tool that stays parked until released, so `steer` and `follow_up` land while
 * the turn's tool call is running, without a sleep. Every later model call
 * answers with the last user message it was given, so each answer shows which
 * messages that call saw.
 *
 * What the Pi SDK (1.4.0) promises, and so what is asserted. Pi owns the queue;
 * these tests observe it and never re-implement it:
 * - Steer enters after the current assistant turn and its tool calls, before the
 *   next model call (docs/sdk.md "Prompting"; `AgentSession.steer` doc comment;
 *   pi-agent-core agent-loop.js `runLoop`: steering is polled after the turn's
 *   tool results, then injected ahead of the next assistant response).
 * - Follow-up enters only after the run has no pending tool calls or steering
 *   left, i.e. once the agent would stop (docs/sdk.md; agent-loop.js `runLoop`
 *   reads the follow-up queue only when the inner loop ends).
 * - `queue_update` carries `steering` and `followUp`; Pi emits it when a message
 *   is queued and again, before the message's `message_start`, when the message
 *   leaves the queue (agent-session.js `_queueSteer`/`_queueFollowUp` and
 *   `_handleAgentEvent`). The bridge forwards both unchanged.
 * - `agent_settled` means Pi will not continue automatically through queued
 *   messages (docs/json.md), so it comes once, after the last queued message.
 *
 * Not asserted: whether a follow-up shares the run's `agent_end` (an
 * implementation detail the docs leave open).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  HOLD_ANSWER_PREFIX,
  HOLD_TOOL_NAME,
  HOLD_TOOL_PROMPT,
} from './fixtures/scripted-hold-extension.js'
import { awaitSettled, startHeldSession, startHoldHarness, started } from './helpers/shippedHold'
import { countOf, expectInOrder, isToolStart, runLog } from './helpers/shippedRunLog'
import type { SidecarHarness } from './helpers/shippedSidecarHarness'

const STEER_TEXT = 'steer: use the other file'
const FOLLOW_UP_TEXT = 'follow-up: then summarise'
const TOOL_RESULT = 'toolResult: hold released'
const TOOL_CALL = `assistant[toolUse]: toolCall ${HOLD_TOOL_NAME}`

/** The label of the assistant answer that echoes `userText` (see the hold provider). */
function answerTo(userText: string): string {
  return `assistant[stop]: ${HOLD_ANSWER_PREFIX}${userText}`
}

function queueLabel(steering: string[], followUp: string[]): string {
  return `queue steer=${JSON.stringify(steering)} followUp=${JSON.stringify(followUp)}`
}

function assistantLabels(log: string[]): string[] {
  return log.filter((entry) => entry.startsWith('assistant['))
}

describe('shipped path: steer and follow-up during a running turn', () => {
  let harness: SidecarHarness | null = null

  beforeAll(async () => {
    harness = await startHoldHarness('queue')
  }, 120_000)

  afterAll(async () => {
    await harness?.dispose()
    harness = null
  })

  it('delivers a steer after the turn tool calls and before the next model call', async () => {
    const h = started(harness)
    await startHeldSession(h, 'steer-start')
    const since = h.events.length
    h.startPrompt(HOLD_TOOL_PROMPT)
    await h.waitForEvent(isToolStart(HOLD_TOOL_NAME), since)

    h.steer(STEER_TEXT)
    await h.waitForEvent((event) => runLog([event])[0] === queueLabel([STEER_TEXT], []), since)
    h.release('tool')
    await awaitSettled(h, since)

    const log = runLog(h.events, since)
    expectInOrder(log, [
      'agent_start',
      `user: ${HOLD_TOOL_PROMPT}`,
      TOOL_CALL,
      `tool_start ${HOLD_TOOL_NAME}`,
      queueLabel([STEER_TEXT], []),
      `tool_end ${HOLD_TOOL_NAME}`,
      TOOL_RESULT,
      'turn_end',
      queueLabel([], []),
      `user: ${STEER_TEXT}`,
      answerTo(STEER_TEXT),
      'agent_settled aborted=false',
    ])
    // The steer waited for the tool: no model call sat between the tool and the steer.
    // The second answer echoes the steer, so the second model call saw it.
    expect(assistantLabels(log)).toEqual([TOOL_CALL, answerTo(STEER_TEXT)])
  }, 60_000)

  it('delivers a follow-up only after the agent stops, never to a model call before that', async () => {
    const h = started(harness)
    await startHeldSession(h, 'follow-up-start')
    const since = h.events.length
    h.startPrompt(HOLD_TOOL_PROMPT)
    await h.waitForEvent(isToolStart(HOLD_TOOL_NAME), since)

    h.followUp(FOLLOW_UP_TEXT)
    await h.waitForEvent((event) => runLog([event])[0] === queueLabel([], [FOLLOW_UP_TEXT]), since)
    h.release('tool')
    await awaitSettled(h, since)

    const log = runLog(h.events, since)
    expectInOrder(log, [
      queueLabel([], [FOLLOW_UP_TEXT]),
      `tool_end ${HOLD_TOOL_NAME}`,
      TOOL_RESULT,
      // The agent stops: this answer is for the prompt, so the follow-up was not in its context.
      answerTo(HOLD_TOOL_PROMPT),
      queueLabel([], []),
      `user: ${FOLLOW_UP_TEXT}`,
      answerTo(FOLLOW_UP_TEXT),
      'agent_settled aborted=false',
    ])
    expect(assistantLabels(log)).toEqual([
      TOOL_CALL,
      answerTo(HOLD_TOOL_PROMPT),
      answerTo(FOLLOW_UP_TEXT),
    ])
    // Settled means no queued message is left to continue with, so it comes once, last.
    expect(countOf(log, 'agent_settled aborted=false')).toBe(1)
    expect(log.at(-1)).toBe('agent_settled aborted=false')
  }, 60_000)

  it('keeps the two queues apart and delivers the steer before the follow-up', async () => {
    const h = started(harness)
    await startHeldSession(h, 'both-start')
    const since = h.events.length
    h.startPrompt(HOLD_TOOL_PROMPT)
    await h.waitForEvent(isToolStart(HOLD_TOOL_NAME), since)

    // Follow-up first on purpose: the order they were queued in must not decide.
    h.followUp(FOLLOW_UP_TEXT)
    h.steer(STEER_TEXT)
    await h.waitForEvent(
      (event) => runLog([event])[0] === queueLabel([STEER_TEXT], [FOLLOW_UP_TEXT]),
      since
    )
    h.release('tool')
    await awaitSettled(h, since)

    const log = runLog(h.events, since)
    expectInOrder(log, [
      queueLabel([], [FOLLOW_UP_TEXT]),
      queueLabel([STEER_TEXT], [FOLLOW_UP_TEXT]),
      `tool_end ${HOLD_TOOL_NAME}`,
      queueLabel([], [FOLLOW_UP_TEXT]),
      `user: ${STEER_TEXT}`,
      answerTo(STEER_TEXT),
      queueLabel([], []),
      `user: ${FOLLOW_UP_TEXT}`,
      answerTo(FOLLOW_UP_TEXT),
      'agent_settled aborted=false',
    ])
    expect(assistantLabels(log)).toEqual([
      TOOL_CALL,
      answerTo(STEER_TEXT),
      answerTo(FOLLOW_UP_TEXT),
    ])
  }, 60_000)
})
