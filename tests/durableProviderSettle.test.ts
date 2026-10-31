import { describe, expect, it, vi } from 'vitest'
import { settleProviders, type ProviderRegistrar } from '../electron/pi/durable/providerSettle'

/**
 * The wait for extension providers to become usable, tested on its own because it has two hazards
 * the rest of the loader does not:
 *
 * 1. `registerNativeProvider` fires its own unawaited availability refresh, and two passes racing
 *    can discard the one that would have marked the provider usable — so one await is not enough.
 * 2. A provider whose auth `resolve` never settles would hang session open forever — so every
 *    attempt is bounded, and giving up is reported rather than waited on.
 */

/** A registrar whose providers become usable after `usableAfter` passes. */
function registrar(options: { usableAfter?: number; hangs?: boolean } = {}): ProviderRegistrar {
  const { usableAfter = 1, hangs = false } = options
  let passes = 0
  return {
    registerProvider: vi.fn(),
    registerNativeProvider: vi.fn(),
    refresh: vi.fn(async () => {
      if (hangs) await new Promise(() => {})
      passes += 1
      return {}
    }),
    hasConfiguredAuth: vi.fn(() => passes >= usableAfter),
  }
}

describe('waiting for extension providers to be usable (#37 item 9)', () => {
  it('re-checks, because a racing refresh can discard the pass that made it usable', async () => {
    // Measured on the real runtime: the unawaited refresh inside registerNativeProvider can win the
    // sequence counter, so the awaited pass is thrown away and the provider stays unusable.
    const models = registrar({ usableAfter: 2 })

    const diagnostics = await settleProviders(models, ['prov-1'])

    expect(models.refresh).toHaveBeenCalledTimes(2)
    expect(diagnostics).toEqual([])
  })

  it('refreshes once even when every provider already counts as configured', async () => {
    // Being configured is not the same as having models: a native provider with a stored credential
    // is "configured" immediately, but its model list only arrives from a refresh. Skipping the pass
    // here made the session fail with "no model has credentials" (measured 20/20 runs).
    const models = registrar({ usableAfter: 0 })

    const diagnostics = await settleProviders(models, ['prov-1'])

    expect(models.refresh).toHaveBeenCalledTimes(1)
    expect(diagnostics).toEqual([])
  })

  it('gives up instead of hanging when a provider never settles', async () => {
    const models = registrar({ hangs: true })

    const diagnostics = await settleProviders(models, ['prov-1'], {
      refreshTimeoutMs: 25,
      refreshAttempts: 3,
    })

    // One attempt, not three: a timeout means the provider is not answering, not that it is slow.
    expect(models.refresh).toHaveBeenCalledTimes(1)
    expect(diagnostics.map((entry) => entry.type)).toEqual(['warning'])
    expect(diagnostics[0]?.message).toContain('did not finish')
  })

  it('reports a provider that is registered but never becomes usable', async () => {
    const models = registrar({ usableAfter: 99 })

    const diagnostics = await settleProviders(models, ['prov-1'], { refreshAttempts: 2 })

    expect(models.refresh).toHaveBeenCalledTimes(2)
    expect(diagnostics[0]?.message).toContain('no usable credentials')
  })

  it('leaves no timer armed, even when the refresh throws synchronously', async () => {
    // An armed timer outlives the wait; a synchronous throw used to skip `clearTimeout` entirely.
    vi.useFakeTimers()
    try {
      const models: ProviderRegistrar = {
        registerProvider: vi.fn(),
        registerNativeProvider: vi.fn(),
        refresh: vi.fn(() => {
          throw new Error('boom')
        }),
        hasConfiguredAuth: vi.fn(() => false),
      }

      const diagnostics = await settleProviders(models, ['prov-1'], { refreshAttempts: 1 })

      expect(vi.getTimerCount()).toBe(0)
      expect(diagnostics[0]?.message).toContain('no usable credentials')
    } finally {
      vi.useRealTimers()
    }
  })

  it('does nothing at all when no provider was registered', async () => {
    const models = registrar()

    expect(await settleProviders(models, [])).toEqual([])
    expect(models.refresh).not.toHaveBeenCalled()
  })
})
