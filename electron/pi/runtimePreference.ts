import { z } from 'zod'

/**
 * Phase 8.3b: which agent runtime a session uses.
 *
 * The SDK path (`pi-coding-agent`) stays the default until the Phase 8 parity matrix passes on all
 * platforms; `durable` is opt-in. The resolver is pure so the decision can be tested and audited
 * without Electron or Pi.
 */

export const runtimePreferenceSchema = z.enum(['sdk', 'durable'])

export type RuntimePreference = z.infer<typeof runtimePreferenceSchema>

/** Preference key as stored by the existing preferences IPC (`GET_PREF`/`SET_PREF`). */
export const RUNTIME_PREF_KEY = 'agent.runtime'

/** The default when nothing is stored, or when the stored value is unreadable. */
export const DEFAULT_RUNTIME: RuntimePreference = 'sdk'

/**
 * Resolve the runtime from the stored preference string.
 *
 * Fails closed: an unknown or corrupted value falls back to the SDK path rather than silently
 * switching runtimes, and a stored `durable` is returned as-is (the caller decides whether this
 * build supports it).
 */
export function resolveRuntime(stored: string | null | undefined): RuntimePreference {
  if (stored === null || stored === undefined || stored === '') return DEFAULT_RUNTIME
  const parsed = runtimePreferenceSchema.safeParse(stored)
  return parsed.success ? parsed.data : DEFAULT_RUNTIME
}

/** True when the durable runtime may be used: opted in and the build supports it. */
export function isDurableRuntimeEnabled(options: {
  stored: string | null | undefined
  durableAvailable: boolean
}): boolean {
  return options.durableAvailable && resolveRuntime(options.stored) === 'durable'
}
