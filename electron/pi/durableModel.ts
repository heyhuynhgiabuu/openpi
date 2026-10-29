import type { Api, Model } from '@earendil-works/pi-ai'
import type { SettingsManager } from '@earendil-works/pi-coding-agent'

/**
 * Which model a durable session runs.
 *
 * The SDK path resolves this internally (`createAgentSession` → `findInitialModel`). The durable
 * harness takes an explicit model, so OpenPi has to choose one. Without any fallback, a workspace
 * with no stored default started on the SDK path and failed on the durable one — opting in broke
 * workspaces that were working. That was found by driving a real session through the renderer
 * (`tests/e2e/durableGate.spec.ts`), not by a unit test.
 *
 * ## Why this is an approximation, not a copy
 *
 * `findInitialModel` orders its choice in three steps: the stored default (with credentials), then
 * a per-provider default model from its `defaultModelPerProvider` table, then the first available
 * model. That table is not exported from `@earendil-works/pi-coding-agent`, and it changes with SDK
 * versions (45+ providers). Reproducing it here would mean a hand-maintained copy that silently
 * picks a different model after an SDK upgrade — worse than an honest gap, because nothing would
 * fail.
 *
 * So steps one and three are implemented, and step two is not. The divergence is narrow and
 * self-correcting: it only applies when no default is stored, and whatever this picks is persisted
 * as the default (`durableHost.ts` `persist.model`), so the next session on either runtime uses the
 * same model. When the fallback is taken it is logged, so the choice is visible rather than implicit.
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
  /** True when no stored default was usable, so this is a fallback rather than the user's choice. */
  fallback: boolean
}

/**
 * The model to run, or `undefined` when nothing is usable: no stored default that resolves with
 * credentials, and no model with credentials at all.
 */
export function chooseDurableModel(
  settings: Pick<SettingsManager, 'getDefaultProvider' | 'getDefaultModel'>,
  models: ModelRuntimeView
): ModelChoice | undefined {
  const provider = settings.getDefaultProvider()
  const modelId = settings.getDefaultModel()
  // A stored pair wins only when it still resolves *and* has credentials: a removed model, or one
  // whose key was deleted, must not be resurrected just because the setting remains. Without the
  // resolve check, a stored id that no longer exists would pass this function and then throw in
  // `durableHost`, where the SDK path would have fallen back.
  if (
    provider &&
    modelId &&
    models.getModel(provider, modelId) &&
    models.hasConfiguredAuth(provider)
  ) {
    return { provider, modelId, fallback: false }
  }
  const first = models.getAvailableSnapshot()[0]
  return first ? { provider: first.provider, modelId: first.id, fallback: true } : undefined
}
