import { z } from 'zod'
import { resolveRuntime, type RuntimePreference } from './runtimePreference'

/**
 * Phase 8.3 cutover gate.
 *
 * The durable runtime is opt-in (`runtimePreference.ts`), but opting in is not enough to switch:
 * a runtime may only serve a session when every capability the app depends on exists for it. This
 * module is the checklist that decision reads, so a half-migrated build cannot silently serve a
 * session with a broken sidebar, missing tool cards, or no customizations.
 *
 * Each capability is a fact reported by the wiring code — never inferred here.
 */
export const durableCapabilitySchema = z.enum([
  'adapter',
  'customizations',
  'policy',
  'mcp',
  'sessionIndex',
  'eventBridge',
  'sessionFiles',
])

export type DurableCapability = z.infer<typeof durableCapabilitySchema>

/** Every capability a session needs before the durable runtime may serve it. */
export const REQUIRED_CAPABILITIES: readonly DurableCapability[] = [
  'adapter',
  'customizations',
  'policy',
  'mcp',
  'sessionIndex',
  'eventBridge',
  'sessionFiles',
]

export const cutoverDecisionSchema = z.object({
  runtime: z.enum(['sdk', 'durable']),
  /** Capabilities the caller reported as present. */
  available: z.array(durableCapabilitySchema),
  /** Required capabilities that are missing; non-empty forces the SDK path. */
  missing: z.array(durableCapabilitySchema),
  /** Human-readable reason, present whenever the durable runtime was requested but not used. */
  reason: z.string().optional(),
})

export type CutoverDecision = z.infer<typeof cutoverDecisionSchema>

/**
 * Decide which runtime serves this session.
 *
 * Order matters: the preference is read first (so the default SDK path never pays for a capability
 * probe), then the build must support it, then every required capability must be present. Any gap
 * falls back to the SDK path with a reason the caller can surface.
 */
export function decideCutover(options: {
  stored: string | null | undefined
  durableAvailable: boolean
  capabilities: readonly DurableCapability[]
}): CutoverDecision {
  const available = REQUIRED_CAPABILITIES.filter((capability) =>
    options.capabilities.includes(capability)
  )
  const preference: RuntimePreference = resolveRuntime(options.stored)

  if (preference !== 'durable') {
    return { runtime: 'sdk', available, missing: [] }
  }
  if (!options.durableAvailable) {
    return {
      runtime: 'sdk',
      available,
      missing: [...REQUIRED_CAPABILITIES],
      reason: 'this build does not include the durable runtime',
    }
  }
  const missing = REQUIRED_CAPABILITIES.filter(
    (capability) => !options.capabilities.includes(capability)
  )
  if (missing.length > 0) {
    return {
      runtime: 'sdk',
      available,
      missing,
      reason: `durable runtime is missing: ${missing.join(', ')}`,
    }
  }
  return { runtime: 'durable', available, missing: [] }
}
