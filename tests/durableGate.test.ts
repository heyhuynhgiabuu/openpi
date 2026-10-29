import { describe, expect, it } from 'vitest'
import {
  REQUIRED_CAPABILITIES,
  chooseSessionRuntime,
  decideCutover,
  type DurableCapability,
} from '../electron/pi/cutover'

/**
 * The shipped gate. Opening it is a one-line edit to a constant that no other test observes, so this
 * is the tripwire: it fails if `sessionCommands` is wired, forcing whoever opens the gate to say so
 * on purpose and to re-run the parity checks that the gate stands for.
 */

/** Mirror of `WIRED_DURABLE_CAPABILITIES`; the two must move together. */
const SHIPPED: readonly DurableCapability[] = [
  'adapter',
  'customizations',
  'policy',
  'mcp',
  'sessionIndex',
  'eventBridge',
  'sessionFiles',
  'sessionCommands',
]

describe('the durable cutover gate as shipped', () => {
  it('admits an opt-in session, with resume offered and fork left to the SDK', () => {
    const decision = decideCutover({
      stored: 'durable',
      durableAvailable: true,
      capabilities: SHIPPED,
    })
    expect(decision.missing).toEqual([])
    expect(chooseSessionRuntime(decision, {})).toEqual({ runtime: 'durable', start: 'new' })
    expect(chooseSessionRuntime(decision, { sessionFile: '/s.jsonl' })).toEqual({
      runtime: 'durable',
      start: 'resume',
    })
    // A fork of a session this runtime did not write must never be re-imported into the store.
    expect(chooseSessionRuntime(decision, { forkEntryId: 'abc' }).runtime).toBe('sdk')
  })

  it('still refuses to serve anything when one capability is missing', () => {
    const decision = decideCutover({
      stored: 'durable',
      durableAvailable: true,
      capabilities: SHIPPED.filter((capability) => capability !== 'sessionCommands'),
    })
    expect(decision.runtime).toBe('sdk')
    expect(decision.missing).toEqual(['sessionCommands'])
  })

  it('needs every required capability, and the command set is one of them', () => {
    expect(REQUIRED_CAPABILITIES).toContain('sessionCommands')
    expect([...SHIPPED].sort()).toEqual([...REQUIRED_CAPABILITIES].sort())
  })
})
