import type { ActiveSession } from './durableTypes'

/**
 * The small read-only views a durable session exposes to the sidecar, kept out of `durableSession.ts`
 * so that factory stays inside the file-size rule.
 */

/**
 * What reopening this session needs, taken while it is still running. Trust is part of it: it is
 * per workspace and decides whether that workspace's MCP servers start, so restoring with the value
 * of whatever request happened to fail would start them in a workspace the user never trusted.
 */
export function reopenableOf(active: ActiveSession | null): Reopenable | undefined {
  if (!active) return undefined
  return {
    sessionId: active.identity.sessionId,
    sessionFile: active.identity.sessionFile,
    startedAt: active.startedAt,
    workspaceTrusted: active.workspaceTrusted,
  }
}

export interface Reopenable {
  sessionId: string
  sessionFile: string
  startedAt: string
  workspaceTrusted: boolean
}
