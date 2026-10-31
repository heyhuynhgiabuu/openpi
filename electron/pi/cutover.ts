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
  'sessionCommands',
  'extensionProviders',
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
  'sessionCommands',
  'extensionProviders',
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

export type SessionRuntimeChoice =
  | { runtime: 'sdk'; reason?: string }
  /**
   * `start` says which way: a request that carries the file of an existing session is `resume`.
   * The durable runtime reopens it only if that file says where its store is
   * (`durable/resumeFile.ts`); a file it did not write, such as an SDK session's, is not its to
   * reopen, so the sidecar falls back to the SDK path.
   */
  | { runtime: 'durable'; reason?: undefined; start: 'new' | 'resume' }

/**
 * Per-session routing once the gate has said `durable`. Forking stays on the SDK path: a fork of an
 * SDK session would re-import it, and exporting that back would flatten its branch tree — a history
 * loss the importer never has to risk. It would also be the wrong store: a fork belongs to the
 * parent's store, which only the runtime that wrote the parent knows.
 */
export function chooseSessionRuntime(
  decision: CutoverDecision,
  request: { sessionFile?: string; forkEntryId?: string }
): SessionRuntimeChoice {
  if (decision.runtime !== 'durable') return { runtime: 'sdk' }
  if (request.forkEntryId) {
    return {
      runtime: 'sdk',
      reason: 'the durable runtime does not fork sessions; forking uses the SDK path',
    }
  }
  return { runtime: 'durable', start: request.sessionFile ? 'resume' : 'new' }
}
