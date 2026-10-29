import { getResourceLoader, getState, send } from './sidecarContext'
import { durableSessions } from './durableHost'

/**
 * What the resource commands need, built from whichever runtime is serving. Kept out of `sidecar.ts`
 * so the wiring itself can be tested: a dropped fallback here leaves the slash picker empty on a
 * durable session while every test of the pieces still passes.
 */
export const resourceCommandDeps = {
  // A durable session has no SDK state; its workspace is what these commands need.
  getCwd: () => getState()?.cwd ?? durableSessions.cwd() ?? null,
  getDurableCommands: () => durableSessions.promptCommands(),
  getSession: () => getState()?.session ?? null,
  getResourceLoader,
  send,
}
