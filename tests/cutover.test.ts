import { describe, expect, it } from 'vitest'
import { REQUIRED_CAPABILITIES, decideCutover } from '../electron/pi/cutover'

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

  it('never reports the durable runtime while session persistence is unwired', () => {
    // This is the shipped state: adapter + event feed exist, persistence and index do not.
    const decision = decideCutover({
      stored: 'durable',
      durableAvailable: true,
      capabilities: ['adapter', 'eventBridge'],
    })
    expect(decision.runtime).toBe('sdk')
    expect(decision.missing).toContain('sessionFiles')
    expect(decision.missing).toContain('sessionIndex')
    expect(decision.missing).not.toContain('eventBridge')
    expect(decision.reason).toContain('durable runtime is missing')
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
