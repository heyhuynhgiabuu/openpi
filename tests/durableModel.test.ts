import type { Api, Model } from '@earendil-works/pi-ai'
import { describe, expect, it, vi } from 'vitest'
import { chooseDurableModel } from '../electron/pi/durableModel'

/**
 * The durable runtime must choose a model the way the SDK path does. A workspace with no stored
 * default starts on the SDK path today; if durable refuses instead, opting in breaks workspaces that
 * were working. That is exactly what driving a real session through the renderer caught, so this
 * mirrors Pi's own `findInitialModel` ordering rather than inventing a simpler one.
 */

interface Entry {
  provider: string
  id: string
}

/**
 * `installed` is what the registry knows; `available` is what it reports as usable (authenticated),
 * which is the only thing the real `getAvailableSnapshot()` returns.
 */
function runtime(installed: Entry[], available = installed) {
  // SAFETY: the code under test only reads `provider` and `id`; a full `Model` needs an api,
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
      { provider: 'anthropic', id: 'claude-opus-4-5' },
    ])
    expect(chooseDurableModel(settings('custom', 'fast'), models)).toEqual({
      provider: 'custom',
      modelId: 'fast',
    })
  })

  it('ignores a stored default with no credentials, as the SDK path does', () => {
    // The setting survives a deleted key; starting the session on it would fail on the first turn.
    // Installed but not authenticated: no snapshot entry, no auth.
    const models = runtime([{ provider: 'custom', id: 'fast' }], [])
    expect(chooseDurableModel(settings('custom', 'fast'), models)).toBeUndefined()
  })

  it('falls back to the first available model when nothing is stored', () => {
    // The case the renderer drive hit: the app runs a model on the SDK path while nothing is stored.
    const models = runtime([{ provider: 'deepseek', id: 'deepseek-flash' }])
    expect(chooseDurableModel(settings(), models)).toEqual({
      provider: 'deepseek',
      modelId: 'deepseek-flash',
    })
  })

  it('prefers a known provider default over an arbitrary first model', () => {
    const models = runtime([
      { provider: 'openrouter', id: 'random' },
      { provider: 'anthropic', id: 'claude-opus-4-5' },
    ])
    expect(chooseDurableModel(settings(), models)).toEqual({
      provider: 'anthropic',
      modelId: 'claude-opus-4-5',
    })
  })

  it('ignores a stored default that no longer resolves', () => {
    const models = runtime([{ provider: 'deepseek', id: 'deepseek-flash' }])
    expect(chooseDurableModel(settings('gone', 'missing'), models)).toEqual({
      provider: 'deepseek',
      modelId: 'deepseek-flash',
    })
  })

  it('reports nothing when no model has credentials', () => {
    expect(chooseDurableModel(settings(), runtime([]))).toBeUndefined()
  })
})
