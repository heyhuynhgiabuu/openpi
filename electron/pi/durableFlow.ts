import type { DurableIdentity, ActiveSession, DurableStartOptions } from './durableTypes'
import { errorText } from './durablePrompt'
import type { SidecarCommand, SidecarMessage } from './sidecarTypes'

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
  send: (message: SidecarMessage) => void
  /** Follow the harness's current conversation after it changed. */
  reattachEvents: (session: ActiveSession) => Promise<void>
  log: (level: 'info' | 'warn' | 'error', text: string) => void
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
    conversationIds: [conversationId],
  }
  session.abortRequested = true
  await session.harness.abort()
  await ops.exportNow(session)
  try {
    await ops.start(session.cwd, {
      workspaceTrusted: cmd.workspaceTrusted,
      requestId: cmd.requestId,
      resume: { identity, startedAt: ops.now().toISOString() },
    })
  } catch (error) {
    // The parent is stopped by now; without it the user is left with no session while the renderer
    // shows the parent. No `requestId`: that request fails with this error, it is not answered.
    await ops
      .start(session.cwd, {
        workspaceTrusted: session.workspaceTrusted,
        resume: { identity: session.identity, startedAt: session.startedAt },
      })
      .catch((restoreError) =>
        ops.log('error', `[durable] could not restore the parent: ${errorText(restoreError)}`)
      )
    throw error
  }
}

const WAIT_FOR_REPLY = 'Wait for the current response to finish before navigating the session tree.'
const WAIT_FOR_MAINTENANCE =
  'Wait for the current compaction or tree navigation to finish before navigating the session tree.'

/**
 * `navigate_tree`: continue the session from an earlier line, in the same file. The conversation
 * is forked there and the fork becomes the one the session runs on, so the abandoned branch stays
 * in the export.
 *
 * Refused while anything is in flight, as the SDK path does: a reply, a compaction, another
 * navigation. That is read from the counters (which move when a command is accepted, before the
 * harness hears of it) and from the store. Overlapping would leave work on a branch the session
 * has left, and its events and result on the wrong one.
 */
export async function navigateSession(
  session: ActiveSession,
  cmd: Extract<SidecarCommand, { type: 'navigate_tree' }>,
  ops: FlowOps
): Promise<void> {
  const { activity } = session
  if (activity.maintenance > 0) throw new Error(WAIT_FOR_MAINTENANCE)
  if (session.streaming || activity.replies > 0) throw new Error(WAIT_FOR_REPLY)
  // From here to the end this is a navigation; the check above and this count share one turn, so
  // a second navigation cannot slip in between.
  activity.maintenance += 1
  const work = (async () => {
    const busy = await session.harness.busy()
    if (busy === 'compaction') throw new Error(WAIT_FOR_MAINTENANCE)
    if (busy === 'reply') throw new Error(WAIT_FOR_REPLY)
    const moved = await session.harness.navigate(cmd.entryId, {
      sessionId: session.identity.sessionId,
      cwd: session.cwd,
      startedAt: session.startedAt,
    })
    if (moved.switched) {
      // Reload and later forks must find every branch, and events now come from the new one.
      session.identity = { ...session.identity, conversationIds: session.harness.conversationIds() }
      await session.stopEvents()
      await ops.reattachEvents(session)
      await ops.exportNow(session)
    }
    return moved
  })()
  // Prompts and compactions that arrive meanwhile wait for the branch to be settled.
  activity.navigation = work.catch(() => undefined)
  try {
    const moved = await work
    const result: Extract<SidecarMessage, { type: 'navigate_tree_result' }>['result'] = {
      cancelled: false,
      leafId: moved.leafLineId,
    }
    if (moved.editorText !== undefined) result.editorText = moved.editorText
    ops.send({ type: 'navigate_tree_result', requestId: cmd.requestId, result })
  } finally {
    activity.maintenance -= 1
    activity.navigation = undefined
  }
}
