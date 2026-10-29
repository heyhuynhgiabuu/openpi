import type { Context } from '@earendil-works/chord'
import type { Harness, Storage } from '@earendil-works/pi-durable'

/**
 * Phase 8 gate condition 4: what an open started, released in reverse.
 *
 * `openDurableHarness` opens a store, then does things that can throw — spawning the MCP bridge,
 * installing its extension, creating the root conversation. Nothing else holds a handle to what it
 * started, so each failure path has to release it on the way out.
 *
 * Two of these are backstops rather than the primary fix, and that is measured, not assumed:
 * pi-durable closes the session's storage itself when a commit fails, so the store survives a failed
 * open with or without `storage` here. The MCP bridge is the one that genuinely leaked — its servers
 * are spawned before the extension is installed, and pi-durable knows nothing about them.
 *
 * Every step is independent: a failing close must not skip the next, and the original error is what
 * the caller sees.
 */
export interface OpenResources {
  /** Closes the MCP bridge, once it exists. */
  closeMcp?: () => Promise<void>
  /** The harness, once it exists. Closing it closes the store too. */
  harness?: Harness
  /** The store, as the final backstop for a harness whose own close threw. */
  storage?: Storage
}

/** Release everything an aborted open started, then rethrow the original error. */
export async function releaseOnFailure(
  resources: OpenResources,
  context: Context,
  error: unknown
): Promise<never> {
  await resources.closeMcp?.().catch(() => undefined)
  await resources.harness?.close(context).catch(() => undefined)
  await resources.storage?.close(context).catch(() => undefined)
  throw error
}
