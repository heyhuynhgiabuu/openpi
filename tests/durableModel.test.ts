import type { Api, Model } from '@earendil-works/pi-ai'
import { describe, expect, it, vi } from 'vitest'
import { chooseDurableModel } from '../electron/pi/durableModel'

/**
 * The durable runtime must be able to start wherever the SDK path can. It previously refused when no
 * default model was stored — a workspace that worked before opting in — which a real renderer drive
 * caught. These cases pin the two rules it does implement; the per-provider default table it cannot
 * reproduce is documented in `durableModel.ts` and logged at runtime.
 */

interface Entry {
  provider: string
  id: string
}

/**
 * `installed` is what the registry knows; `available` is what it reports as usable (authenticated),
 * which is what the real `getAvailableSnapshot()` returns.
 */
function runtime(installed: Entry[], available = installed) {
  // SAFETY: the code under test reads only `provider` and `id`; a full `Model` needs an api,
  // context window, cost table and capabilities that would say nothing about model selection.
  const asModel = (entry: Entry): Model<Api> => entry as unknown as Model<Api>
  return {
    getModel: vi.fn((provider: string, id: string) => {
      const found = installed.find((entry) => entry.provider === provider && entry.id === id)
      return found ? asModel(found) : undefined
    }),
    getAvailableSnapshot: () => available.map(asModel),
    hasConfiguredAuth: vi.fn((provider: string) =>
      available.some((entry) => entry.provider === provider)
    ),
  }
}

const settings = (provider?: string, model?: string) => ({
  getDefaultProvider: () => provider,
  getDefaultModel: () => model,
})

describe('choosing the durable model', () => {
  it('uses the stored default when it resolves and has credentials', () => {
    const models = runtime([
      { provider: 'custom', id: 'fast' },
      { provider: 'anthropic', id: 'claude-opus-4-8' },
    ])
    expect(chooseDurableModel(settings('custom', 'fast'), models)).toEqual({
      provider: 'custom',
      modelId: 'fast',
      fallback: false,
    })
  })

  it('falls back to the first available model when nothing is stored', () => {
    // The case the renderer drive hit: the app runs a model on the SDK path while nothing is stored.
    const models = runtime([{ provider: 'deepseek', id: 'deepseek-v4-pro' }])
    expect(chooseDurableModel(settings(), models)).toEqual({
      provider: 'deepseek',
      modelId: 'deepseek-v4-pro',
      fallback: true,
    })
  })

  it('ignores a stored model id that no longer exists, under a provider that has auth', () => {
    // The provider is authenticated, so only the resolve check can reject this. Without that check
    // the id passes here and then throws in `durableHost`, where the SDK path would have fallen back.
    const models = runtime([{ provider: 'deepseek', id: 'deepseek-v4-pro' }])
    expect(chooseDurableModel(settings('deepseek', 'removed-model'), models)).toEqual({
      provider: 'deepseek',
      modelId: 'deepseek-v4-pro',
      fallback: true,
    })
  })

  it('ignores a stored default whose provider has no credentials', () => {
    // Installed but not authenticated: no snapshot entry, no auth.
    const models = runtime([{ provider: 'custom', id: 'fast' }], [])
    expect(chooseDurableModel(settings('custom', 'fast'), models)).toBeUndefined()
  })

  it('reports nothing when no model has credentials', () => {
    expect(chooseDurableModel(settings(), runtime([]))).toBeUndefined()
  })
})
