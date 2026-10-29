import { readFile } from 'node:fs/promises'
import type { DurableIdentity, DurableStartOptions } from './durableTypes'
import { readResumeTarget, type DurableHeader } from './durable/resumeFile'

/**
 * Phase 8.4a: reopening a durable session after a restart.
 *
 * The session file is the only thing a restart has: the store id and the conversations are written
 * into its header (`resumeFile.ts`), because a forked or navigated session's store is not named
 * after the session id.
 */

/** What a restart needs to find this session's store again. */
export function durableHeaderOf(
  identity: DurableIdentity,
  conversationIds: number[]
): DurableHeader {
  return { storeId: identity.storeId ?? identity.sessionId, conversationIds }
}

/** `resumeFrom` for the session factory, which owns the `start` it resumes through. */
export function createResumeFrom(
  start: StartSession
): (cwd: string, sessionFile: string, trusted: boolean, requestId?: string) => Promise<boolean> {
  return (cwd, sessionFile, workspaceTrusted, requestId) =>
    resumeDurableFromFile(cwd, sessionFile, workspaceTrusted, requestId, start)
}

type StartSession = (cwd: string, options: DurableStartOptions) => Promise<void>

/**
 * Whether this runtime can reopen the file. Reading only — no store is opened — so a caller can
 * decide before it disposes the session it is running.
 */
export async function canResumeFile(sessionFile: string): Promise<boolean> {
  const text = await readFile(sessionFile, 'utf8').catch(() => undefined)
  return text !== undefined && readResumeTarget(text) !== undefined
}

/**
 * Resume the session an exported file belongs to. `false` when the file says nothing about a store
 * — an SDK session, or one written before this slice — so the caller can use the SDK path.
 *
 * The identity is taken from the file, not from the request, so a resume cannot point at another
 * session's store: the file is the one the user opened.
 */

export async function resumeDurableFromFile(
  cwd: string,
  sessionFile: string,
  workspaceTrusted: boolean,
  requestId: string | undefined,
  start: StartSession
): Promise<boolean> {
  const text = await readFile(sessionFile, 'utf8').catch(() => undefined)
  const target = text === undefined ? undefined : readResumeTarget(text)
  if (!target) return false
  const identity: DurableIdentity = {
    sessionId: target.sessionId,
    sessionFile,
    storeId: target.storeId,
    conversationIds: target.conversationIds,
  }
  await start(cwd, {
    // The reply `session_ready` must carry this, or the open request that asked for the session
    // waits for an answer that never names it.
    requestId,
    workspaceTrusted,
    resume: { identity, startedAt: target.startedAt },
  })
  return true
}
