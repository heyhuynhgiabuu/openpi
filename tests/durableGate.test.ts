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
  it('is open: an opt-in session runs on the durable runtime', () => {
    // Opened once the conditions blocking it were done and tested; see ROADMAP Phase 8 items 4 and 5.
    expect(decide(SHIPPED).missing).toEqual([])
    expect(chooseSessionRuntime(decide(SHIPPED), {})).toEqual({ runtime: 'durable', start: 'new' })
    // The default is untouched: without the preference stored, a session stays on the SDK path.
    expect(
      decideCutover({ stored: undefined, durableAvailable: true, capabilities: SHIPPED }).runtime
    ).toBe('sdk')
  })

  it('requires exactly these capabilities, so dropping one is a visible change', () => {
    // Both the gate constant and `REQUIRED_CAPABILITIES` are read from the source elsewhere, which
    // makes every other assertion here move with them: a capability could vanish and nothing fail.
    // This list is the pin. Adding a capability to the runtime means adding it here deliberately.
    expect([...SHIPPED].sort()).toEqual(
      [
        'adapter',
        'customizations',
        'eventBridge',
        'extensionProviders',
        'mcp',
        'policy',
        'sessionCommands',
        'sessionFiles',
        'sessionIndex',
      ].sort()
    )
    expect([...REQUIRED_CAPABILITIES].sort()).toEqual([...SHIPPED].sort())
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

  it('wires exactly what the gate requires, and nothing else', () => {
    // A capability wired but not required would be untested surface: the gate's own list is the
    // contract, so anything beyond it is either a typo or a required capability left out.
    for (const capability of SHIPPED) expect(REQUIRED_CAPABILITIES).toContain(capability)
    // Every required capability being wired is what "open" means; if one is added to the list above
    // this fails until it is genuinely wired, rather than silently gating a feature behind nothing.
    expect([...SHIPPED].sort()).toEqual([...REQUIRED_CAPABILITIES].sort())
  })
})
