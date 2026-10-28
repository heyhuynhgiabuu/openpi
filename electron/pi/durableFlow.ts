import type { DurableIdentity, ActiveSession, DurableStartOptions } from './durableTypes'
import type { SidecarCommand } from './sidecarTypes'

/**
 * Phase 8.3o: the commands that replace the running session with another over the same store:
 * `reload_session` (the same session, restarted) and `fork_session` (a new one branched from an
 * entry). Both first stop whatever the old session is doing, as the SDK path's dispose does.
 */

export interface FlowOps {
  exportNow: (session: ActiveSession) => Promise<void>
  start: (cwd: string, options: DurableStartOptions) => Promise<void>
  newIdentity: (cwd: string) => DurableIdentity
  now: () => Date
}

/**
 * `reload_session`: a full restart of the harness over the same store, file and header, so
 * extensions, customizations and MCP servers are discovered afresh and the history is untouched.
 * A run in flight is aborted first: merely closing the harness would leave the run pending in the
 * store, and the next submit would start it again.
 */
export async function reloadSession(
  session: ActiveSession,
  requestId: string,
  ops: FlowOps
): Promise<void> {
  session.abortRequested = true
  await session.harness.abort()
  await ops.exportNow(session)
  await ops.start(session.cwd, {
    workspaceTrusted: session.workspaceTrusted,
    requestId,
    resume: { identity: session.identity, startedAt: session.startedAt },
  })
}

/**
 * `fork_session`: a new session whose history is the parent's up to and including the entry, with
 * its own id and file, like the SDK path's branched session. The fork is created in the parent's
 * store as a conversation of its own, and before the parent is touched, so an entry that cannot be
 * found fails the command and leaves the parent running.
 */
export async function forkSession(
  session: ActiveSession,
  cmd: Extract<SidecarCommand, { type: 'fork_session' }>,
  ops: FlowOps
): Promise<void> {
  const conversationId = await session.harness.fork(cmd.entryId, {
    sessionId: session.identity.sessionId,
    cwd: session.cwd,
    startedAt: session.startedAt,
  })
  const identity: DurableIdentity = {
    ...ops.newIdentity(session.cwd),
    storeId: session.identity.storeId ?? session.identity.sessionId,
    conversationId,
  }
  session.abortRequested = true
  await session.harness.abort()
  await ops.exportNow(session)
  await ops.start(session.cwd, {
    workspaceTrusted: cmd.workspaceTrusted,
    requestId: cmd.requestId,
    resume: { identity, startedAt: ops.now().toISOString() },
  })
}
