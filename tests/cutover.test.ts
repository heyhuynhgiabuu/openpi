import { describe, expect, it } from 'vitest'
import { REQUIRED_CAPABILITIES, chooseSessionRuntime, decideCutover } from '../electron/pi/cutover'

/**
 * Phase 8.3 cutover gate: an opt-in never switches the runtime unless every capability exists, and
 * the default path never pays for a capability probe's consequences.
 */

describe('cutover decision', () => {
  it('stays on the SDK path when nothing is stored', () => {
    const decision = decideCutover({
      stored: null,
      durableAvailable: true,
      capabilities: REQUIRED_CAPABILITIES,
    })
    expect(decision.runtime).toBe('sdk')
    expect(decision.reason).toBeUndefined()
  })

  it('never reports the durable runtime while the command set is incomplete', () => {
    // This is the shipped state: every building block exists, but steer/follow-up/abort/model/
    // thinking/compact/bash/fork/navigate do not, so the opt-in must not switch.
    const decision = decideCutover({
      stored: 'durable',
      durableAvailable: true,
      capabilities: REQUIRED_CAPABILITIES.filter((capability) => capability !== 'sessionCommands'),
    })
    expect(decision.runtime).toBe('sdk')
    expect(decision.missing).toEqual(['sessionCommands'])
    expect(decision.reason).toContain('sessionCommands')
  })

  it('switches only when every required capability is present', () => {
    const decision = decideCutover({
      stored: 'durable',
      durableAvailable: true,
      capabilities: REQUIRED_CAPABILITIES,
    })
    expect(decision.runtime).toBe('durable')
    expect(decision.missing).toEqual([])
    expect(decision.reason).toBeUndefined()
  })

  it('reports every capability as missing when the build lacks the runtime', () => {
    const decision = decideCutover({
      stored: 'durable',
      durableAvailable: false,
      capabilities: REQUIRED_CAPABILITIES,
    })
    expect(decision.runtime).toBe('sdk')
    expect(decision.missing).toEqual([...REQUIRED_CAPABILITIES])
    expect(decision.reason).toContain('does not include the durable runtime')
  })

  it('treats an unreadable preference as the SDK default', () => {
    const decision = decideCutover({
      stored: 'Durable',
      durableAvailable: true,
      capabilities: REQUIRED_CAPABILITIES,
    })
    expect(decision.runtime).toBe('sdk')
  })

  it('reports only the capabilities the caller actually has', () => {
    const decision = decideCutover({
      stored: 'durable',
      durableAvailable: true,
      capabilities: ['adapter', 'policy', 'not-a-capability' as never],
    })
    expect(decision.available).toEqual(['adapter', 'policy'])
  })
})

describe('per-session runtime choice', () => {
  const durable = decideCutover({
    stored: 'durable',
    durableAvailable: true,
    capabilities: REQUIRED_CAPABILITIES,
  })
  const sdk = decideCutover({ stored: null, durableAvailable: true, capabilities: [] })

  it('starts a new session on the durable runtime when the gate allows it', () => {
    expect(chooseSessionRuntime(durable, {})).toEqual({ runtime: 'durable' })
  })

  it('keeps resume and fork on the SDK path so a branch tree is never flattened', () => {
    const resumed = chooseSessionRuntime(durable, { sessionFile: '/s.jsonl' })
    const forked = chooseSessionRuntime(durable, { sessionFile: '/s.jsonl', forkEntryId: 'abc' })
    expect(resumed.runtime).toBe('sdk')
    expect(resumed.reason).toContain('new sessions only')
    expect(forked.runtime).toBe('sdk')
  })

  it('never upgrades a session the gate sent to the SDK', () => {
    expect(chooseSessionRuntime(sdk, {})).toEqual({ runtime: 'sdk' })
  })
})
