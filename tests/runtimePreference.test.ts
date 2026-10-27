import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RUNTIME,
  RUNTIME_PREF_KEY,
  isDurableRuntimeEnabled,
  resolveRuntime,
} from '../electron/pi/runtimePreference'

/** Phase 8.3b: the runtime choice fails closed to the shipped SDK path. */

describe('runtime preference', () => {
  it('defaults to the SDK path when nothing is stored', () => {
    expect(resolveRuntime(null)).toBe('sdk')
    expect(resolveRuntime(undefined)).toBe('sdk')
    expect(resolveRuntime('')).toBe('sdk')
    expect(DEFAULT_RUNTIME).toBe('sdk')
  })

  it('accepts an explicit durable opt-in', () => {
    expect(resolveRuntime('durable')).toBe('durable')
    expect(resolveRuntime('sdk')).toBe('sdk')
  })

  it('falls back to the SDK path for unknown values instead of guessing', () => {
    expect(resolveRuntime('Durable')).toBe('sdk')
    expect(resolveRuntime('true')).toBe('sdk')
    expect(resolveRuntime('{"runtime":"durable"}')).toBe('sdk')
  })

  it('uses a stable preference key', () => {
    expect(RUNTIME_PREF_KEY).toBe('agent.runtime')
  })

  it('requires both the opt-in and build support for the durable runtime', () => {
    expect(isDurableRuntimeEnabled({ stored: 'durable', durableAvailable: true })).toBe(true)
    expect(isDurableRuntimeEnabled({ stored: 'durable', durableAvailable: false })).toBe(false)
    expect(isDurableRuntimeEnabled({ stored: 'sdk', durableAvailable: true })).toBe(false)
    expect(isDurableRuntimeEnabled({ stored: null, durableAvailable: true })).toBe(false)
  })
})
