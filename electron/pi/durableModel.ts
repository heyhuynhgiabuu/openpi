import type { Api, Model } from '@earendil-works/pi-ai'
import type { SettingsManager } from '@earendil-works/pi-coding-agent'

/**
 * Which model a durable session runs.
 *
 * The SDK path resolves this itself (`createAgentSession` → `findInitialModel`): the stored default
 * when it has credentials, otherwise the first model that does. The durable harness takes an
 * explicit model, so it has to make the same choice. Without it, a workspace with no stored default
 * starts on the SDK path and fails on the durable one with "needs a default model" — the runtime
 * refusing precisely where the runtime it replaces worked. That asymmetry was found by driving a
 * real session through the renderer (`tests/e2e/durableGate.spec.ts`), not by a unit test.
 */

/** The part of the model runtime this needs; `ModelRuntime` satisfies it structurally. */
export interface ModelRuntimeView {
  getModel(providerId: string, modelId: string): Model<Api> | undefined
  getAvailableSnapshot(): readonly Model<Api>[]
  hasConfiguredAuth(providerId: string): boolean
}

export interface ModelChoice {
  provider: string
  modelId: string
}

/**
 * Providers whose default model is preferred over an arbitrary first entry, mirroring
 * `defaultModelPerProvider` from Pi's own resolver. Kept here because that table is not exported.
 */
const PREFERRED_DEFAULTS: Readonly<Record<string, string>> = {
  anthropic: 'claude-opus-4-5',
  openai: 'gpt-5.5',
  google: 'gemini-3-pro-preview',
  deepseek: 'deepseek-chat',
}

/**
 * The model to run, or `undefined` when nothing is usable. Ordering matches `findInitialModel`:
 * stored default with auth, then a known provider default that is available, then the first
 * available model.
 */
export function chooseDurableModel(
  settings: Pick<SettingsManager, 'getDefaultProvider' | 'getDefaultModel'>,
  models: ModelRuntimeView
): ModelChoice | undefined {
  const provider = settings.getDefaultProvider()
  const modelId = settings.getDefaultModel()
  // A stored pair wins only when it still resolves *and* has credentials: a removed provider, or
  // one whose key was deleted, must not be resurrected just because the setting remains.
  if (
    provider &&
    modelId &&
    models.getModel(provider, modelId) &&
    models.hasConfiguredAuth(provider)
  ) {
    return { provider, modelId }
  }
  const available = models.getAvailableSnapshot()
  for (const [providerId, defaultId] of Object.entries(PREFERRED_DEFAULTS)) {
    const match = available.find((entry) => entry.provider === providerId && entry.id === defaultId)
    if (match) return { provider: match.provider, modelId: match.id }
  }
  const first = available[0]
  return first ? { provider: first.provider, modelId: first.id } : undefined
}
