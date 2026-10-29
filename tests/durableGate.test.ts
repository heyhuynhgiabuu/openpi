import { describe, expect, it } from 'vitest'
import {
  REQUIRED_CAPABILITIES,
  chooseSessionRuntime,
  decideCutover,
  type DurableCapability,
} from '../electron/pi/cutover'
import { WIRED_DURABLE_CAPABILITIES } from '../electron/pi/sessionLifecycle'

/**
 * The shipped gate, read from the constant itself so this test moves with the gate and fails if
 * either direction changes without the test being updated next to it. Opening or closing the gate is
 * therefore a deliberate act rather than a line nothing observes.
 */

const SHIPPED: readonly DurableCapability[] = WIRED_DURABLE_CAPABILITIES

function decide(capabilities: readonly DurableCapability[]) {
  return decideCutover({ stored: 'durable', durableAvailable: true, capabilities })
}

describe('the durable cutover gate as shipped', () => {
  it('is closed: an opt-in session still runs on the Pi SDK path', () => {
    // Closed until a real session has been driven through the renderer; see ROADMAP Phase 8.
    expect(decide(SHIPPED).runtime).toBe('sdk')
    expect(decide(SHIPPED).missing).toEqual(['sessionCommands'])
    expect(chooseSessionRuntime(decide(SHIPPED), {})).toEqual({ runtime: 'sdk' })
  })

  it('admits an opt-in session once every required capability is wired', () => {
    const decision = decide(REQUIRED_CAPABILITIES)
    expect(decision.missing).toEqual([])
    expect(chooseSessionRuntime(decision, {})).toEqual({ runtime: 'durable', start: 'new' })
    expect(chooseSessionRuntime(decision, { sessionFile: '/s.jsonl' })).toEqual({
      runtime: 'durable',
      start: 'resume',
    })
    // A fork of a session this runtime did not write must never be re-imported into the store.
    expect(chooseSessionRuntime(decision, { forkEntryId: 'abc' }).runtime).toBe('sdk')
  })

  it('wires nothing the gate does not require', () => {
    // A capability wired but not required would be untested surface: the gate's own list is the
    // contract, so anything beyond it is either a typo or a required capability left out.
    for (const capability of SHIPPED) expect(REQUIRED_CAPABILITIES).toContain(capability)
    expect(SHIPPED).not.toContain('sessionCommands')
  })
})
