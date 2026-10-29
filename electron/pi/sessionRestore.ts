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
}

/** The session running now, in the shape a fresh start needs. */
export function previousSession(): PreviousSession | undefined {
  const state = getState()
  if (!state) return undefined
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
    options: { sessionFile?: string; workspaceTrusted: boolean }
  ) => Promise<void>
): Promise<void> {
  const options: { sessionFile?: string; workspaceTrusted: boolean } = {
    workspaceTrusted: previous.workspaceTrusted,
  }
  if (previous.sessionFile) options.sessionFile = previous.sessionFile
  return start(previous.cwd, options).catch((error: unknown) => {
    outputLine(
      'error',
      `[session] could not restore the previous session: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  })
}
