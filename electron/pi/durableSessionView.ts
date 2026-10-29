import type { ActiveSession } from './durableTypes'

/**
 * The small read-only views a durable session exposes to the sidecar, kept out of `durableSession.ts`
 * so that factory stays inside the file-size rule.
 */

/** What reopening this session needs, taken while it is still running. */
export function reopenableOf(
  active: ActiveSession | null
): { sessionId: string; sessionFile: string; startedAt: string } | undefined {
  if (!active) return undefined
  return {
    sessionId: active.identity.sessionId,
    sessionFile: active.identity.sessionFile,
    startedAt: active.startedAt,
  }
}
