import type { DurableSessions } from './durableTypes'
import type { PreviousSession } from './sessionRestore'

/**
 * The durable branch of `startSession`: read the file, dispose the session it replaces, open the
 * durable one, and put the previous session back if that fails.
 *
 * Kept out of `sessionLifecycle.ts` so the routing there stays readable; it holds no state of its
 * own.
 */

export interface DurableStartDeps {
  sessions: DurableSessions
  trusted: boolean
  cwd: string
  sessionFile?: string
  requestId?: string
  /** `new` or `resume`, from the cutover choice. */
  start: 'new' | 'resume'
  /** The session in place before this one was disposed, for the fallback. */
  previous: PreviousSession | undefined
  stopSdk: (reason: 'new' | 'resume') => Promise<void>
  restore: (previous: PreviousSession) => Promise<void>
}

/** The file stopped being one this runtime wrote between the check and the open. */
export class DurableStartError extends Error {}

export async function startDurable(deps: DurableStartDeps): Promise<void> {
  const { sessions, trusted, cwd, sessionFile, requestId, start } = deps
  await deps.stopSdk(start)
  const reopen = async (): Promise<void> => {
    if (sessionFile && start === 'resume') {
      // `canResume` said yes, but the file can change between the two reads. The sidecar is left
      // without a session either way (see `WIRED_DURABLE_CAPABILITIES`); at least answer the open
      // request instead of leaving main to time out against a session that will never exist.
      const resumed = await sessions.resumeFrom(cwd, sessionFile, trusted, requestId)
      if (!resumed) {
        throw new DurableStartError(
          `${sessionFile} changed while it was being opened; open it again to continue`
        )
      }
      return
    }
    await sessions.start(cwd, { workspaceTrusted: trusted, requestId })
  }
  try {
    await reopen()
  } catch (error) {
    // Main restores what it was showing, so leaving the sidecar empty would look healthy while
    // every prompt goes nowhere. Put the previous session back instead, as a failed fork does.
    if (deps.previous) await deps.restore(deps.previous)
    throw error
  }
}
