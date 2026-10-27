/**
 * Test-flow helpers shared by the run-start / steer / follow-up / abort tests:
 * a harness with the hold extension installed, a session on its held model,
 * and the waits every one of those tests ends with.
 */
import { HOLD_MODEL, HOLD_PROVIDER } from '../fixtures/scripted-hold-extension.js'
import { isEvent } from './shippedRunLog'
import type { SessionEvent } from './shippedReplies'
import { startSidecarHarness, type SidecarHarness } from './shippedSidecarHarness'

/** Bundles the sidecar with the hold extension installed next to the scripted provider. */
export function startHoldHarness(cacheName: string): Promise<SidecarHarness> {
  return startSidecarHarness({ cacheName, holdExtension: true })
}

/** The running harness; beforeAll sets it, so null here is a harness bug, not a test result. */
export function started(harness: SidecarHarness | null): SidecarHarness {
  if (!harness) throw new Error('sidecar harness is not running')
  return harness
}

/** Starts a fresh session and selects the hold extension's model, so each test owns a clean run history. */
export async function startHeldSession(h: SidecarHarness, requestId: string): Promise<void> {
  await h.startSession(requestId)
  await h.selectModel(HOLD_PROVIDER, HOLD_MODEL)
}

/** Resolves with the first `agent_settled` event at or after log index `since`. */
export function awaitSettled(h: SidecarHarness, since: number): Promise<SessionEvent> {
  return h.waitForEvent(isEvent('agent_settled'), since)
}
