import { SessionManager } from '@earendil-works/pi-coding-agent'
import { getState, outputLine } from './sidecarContext'

/**
 * Putting back the session a replacement disposed before its successor failed to start.
 *
 * Main restores what it was showing when a start request fails, so a sidecar left without a session
 * looks healthy from the renderer while every prompt goes nowhere.
 */

export interface PreviousSession {
  cwd: string
  sessionFile?: string
  workspaceTrusted: boolean
  /** The same session in the durable runtime's terms, when that is what was running. */
  durable?: { sessionId: string; sessionFile: string; startedAt: string }
  /**
   * The runtime preference the session was started under. Without it the gate sees no preference
   * and reopens the session on the SDK path, which is not the runtime it came from.
   */
  runtimePreference?: string
}

/**
 * The session running now, in the shape a fresh start needs. A durable session keeps nothing in
 * `getState()`, so it is asked for its own identity; `startSession` reads that instead of opening a
 * new session over the store.
 */
export interface ServingDurable {
  cwd: string
  workspaceTrusted: boolean
  /** The preference the durable session is running under, so the restore reopens on it. */
  runtimePreference?: string
  reopenable?: () => PreviousSession['durable']
}

/**
 * Validate the fork identity before the active session is disposed, so a malformed or stale entry id
 * cannot leave the sidecar without a session. Returns the file to open, or undefined for no fork.
 */
export function prepareFork(
  opts: { sessionFile?: string; forkEntryId?: string },
  cwd: string
): string | undefined {
  if (!opts.sessionFile || !opts.forkEntryId) return undefined
  const manager = SessionManager.open(opts.sessionFile, undefined, cwd)
  const file = manager.createBranchedSession(opts.forkEntryId) ?? undefined
  if (!file) throw new Error(`Cannot fork: entry not found (${opts.forkEntryId})`)
  return file
}

export function previousSession(durable?: ServingDurable): PreviousSession | undefined {
  const reopenable = durable?.reopenable?.()
  if (durable && reopenable) {
    const previous: PreviousSession = {
      cwd: durable.cwd,
      workspaceTrusted: durable.workspaceTrusted,
      sessionFile: reopenable.sessionFile,
      durable: reopenable,
    }
    if (durable.runtimePreference) previous.runtimePreference = durable.runtimePreference
    return previous
  }
  const state = getState()
  if (!state) return undefined
  // An SDK session restores on the SDK path: the durable preference belongs to a durable session,
  // and carrying it here would send the SDK file through the durable gate.
  const previous: PreviousSession = { cwd: state.cwd, workspaceTrusted: state.workspaceTrusted }
  if (state.session.sessionFile) previous.sessionFile = state.session.sessionFile
  return previous
}

/**
 * Reopen the previous session. No `requestId`: the request that failed gets its own error, so
 * answering it with this session's `session_ready` would name the wrong session as started.
 */
export function restoreSession(
  previous: PreviousSession,
  start: (
    cwd: string,
    options: {
      sessionFile?: string
      workspaceTrusted: boolean
      runtimePreference?: string
      restoring: boolean
    }
  ) => Promise<void>
): Promise<void> {
  const options: {
    sessionFile?: string
    workspaceTrusted: boolean
    runtimePreference?: string
    restoring: boolean
  } = { workspaceTrusted: previous.workspaceTrusted, restoring: true }
  if (previous.runtimePreference) options.runtimePreference = previous.runtimePreference
  // The workspace the session was running in, not the one the failed request named.
  const cwd = previous.cwd
  // A durable session restores by reopening the file it exported, which the durable branch does
  // with `resumeFrom`; the identity above is what lets it pick the durable runtime for it.
  if (previous.sessionFile) options.sessionFile = previous.sessionFile
  return start(cwd, options).catch((error: unknown) => {
    outputLine(
      'error',
      `[session] could not restore the previous session: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  })
}
