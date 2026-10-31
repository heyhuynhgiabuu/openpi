import type { Provider } from '@earendil-works/pi-ai'
import type { ProviderConfig } from '@earendil-works/pi-coding-agent'
import type { CustomizationDiagnostic } from '../../../src/lib/ipc'

/**
 * Wait until the registered extension providers are actually usable, without letting a broken one
 * stall session open.
 *
 * `registerNativeProvider` fires its own unawaited availability refresh. Two passes racing can each
 * bump the runtime's sequence counter and discard the other's result, so the provider that was just
 * registered stays "not configured" even though the await above returned — measured at roughly
 * 5–50% of runs depending on load. Hence: re-check, retry a bounded number of times, and never wait
 * forever. A provider whose auth `resolve` never settles would otherwise hang the open with no
 * output at all.
 */

export interface ProviderRegistrar {
  /** Config form: what the extension-facing `registerProvider` takes. */
  registerProvider(providerId: string, config: ProviderConfig): void
  /** Native form: a whole `Provider` object rather than a config. */
  registerNativeProvider(provider: Provider): void
  /** Recomputes which models are available. `allowNetwork: false` keeps it offline. */
  refresh(options: { allowNetwork: boolean }): Promise<object>
  /** Whether a provider is usable right now — the question a refresh is trying to answer. */
  hasConfiguredAuth(providerId: string): boolean
  /**
   * The runtime's last reported error, if it kept one. Note this is a single global message — a
   * models.json parse error, a provider-build error or the last availability failure — not a
   * per-provider reason, so it is read once and only appended as context.
   */
  getError?(): string | undefined
}

export interface ProviderLoadOptions {
  /** How long one availability attempt may take. */
  refreshTimeoutMs?: number
  /** Attempts before giving up; a provider that never settles is reported, not waited on forever. */
  refreshAttempts?: number
}

const DEFAULT_REFRESH_TIMEOUT_MS = 2000
const DEFAULT_REFRESH_ATTEMPTS = 3

/**
 * Await `start()`, but no longer than `ms`. Resolves false only on timeout.
 *
 * A rejection counts as finished on purpose: the caller re-checks usability afterwards and reports
 * what is actually true, so one rejected pass is information rather than a failed load.
 */
async function settle(start: () => Promise<object>, ms: number): Promise<boolean> {
  // `start()` is called inside the guarded region: a synchronous throw would otherwise skip the
  // `clearTimeout` below and leave the timer armed.
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms)
  })
  const attempt = (async () => {
    try {
      await start()
      return true
    } catch {
      return true
    }
  })()
  return Promise.race([attempt, timeout]).finally(() => clearTimeout(timer))
}

/** Diagnostics for whichever registered providers are still unusable after the bounded retries. */
export async function settleProviders(
  models: ProviderRegistrar,
  registered: readonly string[],
  options: ProviderLoadOptions = {}
): Promise<CustomizationDiagnostic[]> {
  if (registered.length === 0) return []
  const timeoutMs = options.refreshTimeoutMs ?? DEFAULT_REFRESH_TIMEOUT_MS
  const attempts = options.refreshAttempts ?? DEFAULT_REFRESH_ATTEMPTS
  const unusable = () => registered.filter((id) => !models.hasConfiguredAuth(id))

  // At least one attempt always runs, even when every provider already counts as configured: being
  // configured is not the same as having a model list. A native provider whose models are published
  // by `refreshModels` is "configured" from its stored credential yet has no models until a pass
  // runs, and `registerNativeProvider`'s own refresh is fire-and-forget.
  for (let attempt = 0; attempt < Math.max(attempts, 1); attempt += 1) {
    if (attempt > 0 && unusable().length === 0) break
    if (!(await settle(() => models.refresh({ allowNetwork: false }), timeoutMs)))
      return [
        {
          type: 'warning',
          message: `[durable] an extension provider did not finish its availability check within ${timeoutMs}ms; the model choice may not see it`,
        },
      ]
  }

  const left = unusable()
  if (left.length === 0) return []
  // The runtime refreshes every provider with `Promise.all`, so one throwing `resolve` also leaves
  // its neighbours unusable and the message above names providers that are fine. Append the
  // runtime's own error as context when it kept one; it is a single global string, not per provider.
  const reason = models.getError?.() ?? ''
  const detail = reason.length > 0 ? ` (${reason})` : ''
  return [
    {
      type: 'warning',
      message: `[durable] extension provider(s) ${left.join(', ')} have no usable credentials${detail}`,
    },
  ]
}
