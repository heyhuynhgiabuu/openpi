/**
 * Session-flow sidecar commands: starting (new/resume/fork), reload-as-
 * replacement, tree navigation, and shutdown. Pure move of the corresponding
 * cases from sidecar.ts's command switch.
 */

import type { SidecarCommand } from './sidecarTypes'
import { getState, send, setState } from './sidecarContext'
import { startSession, stopSession } from './sessionLifecycle'

export async function handleStartSessionCommand(
  cmd: Extract<SidecarCommand, { type: 'start_session' }>
): Promise<void> {
  try {
    await startSession(cmd.cwd, {
      sessionFile: cmd.sessionFile,
      forkEntryId: cmd.forkEntryId,
      requestId: cmd.requestId,
      workspaceTrusted: cmd.workspaceTrusted,
    })
  } catch (err) {
    send({
      type: 'session_error',
      requestId: cmd.requestId,
      message: err instanceof Error ? err.message : String(err),
    })
  }
}

export async function handleReloadSessionCommand(
  cmd: Extract<SidecarCommand, { type: 'reload_session' }>
): Promise<void> {
  const state = getState()
  if (!state) {
    send({
      type: 'error',
      requestId: cmd.requestId,
      message: 'No active session',
    })
    return
  }
  // /reload triggers an SDK session.reload() which invalidates all
  // extension ctxs. pi-task captures `pi` (ExtensionAPI) in its background
  // polling closure, so in-flight async work calls `pi.sendMessage` on
  // a stale ctx and throws "this extension ctx is stale...".
  //
  // The safe path is a full session replacement: dispose the current
  // session (atomically destroying its extension runner + timers) and
  // create a new one with the same session file. All old extension state
  // goes away cleanly; new state is re-initialized.
  try {
    const previous = state
    setState(null)
    previous.unsubscribe()
    await stopSession(previous.session, 'reload')
    await startSession(previous.cwd, {
      sessionFile: previous.session.sessionFile ?? undefined,
      requestId: cmd.requestId,
      workspaceTrusted: previous.workspaceTrusted,
    })
  } catch (err) {
    send({
      type: 'error',
      requestId: cmd.requestId,
      message: err instanceof Error ? err.message : String(err),
    })
  }
}

export async function handleForkSessionCommand(
  cmd: Extract<SidecarCommand, { type: 'fork_session' }>
): Promise<void> {
  const state = getState()
  if (!state) {
    send({ type: 'error', requestId: cmd.requestId, message: 'No active session' })
    return
  }

  // Resolve the fork entry ID.
  //
  // During live streaming, sessionEvents.ts assigns synthetic display IDs
  // ("u-{timestampMs}" for user messages, "a-{timestampMs}" for assistant)
  // because the Pi SDK's message_start event does not include the real
  // session entry ID. These synthetic IDs are NOT valid Pi session entry IDs
  // and cause "Entry not found" errors inside createBranchedSession().
  //
  // Resolution strategy: extract the encoded Unix timestamp from the synthetic
  // ID and find the matching session entry via sessionManager.getEntries().
  // By the time the user can click Fork, message_end has fired and
  // sessionManager.appendMessage() has persisted the entry — so getEntries()
  // will contain the real entry with the correct timestamp.
  let forkEntryId = cmd.entryId
  const syntheticMatch = /^[ua]-(-?\d+)$/.exec(cmd.entryId)
  if (syntheticMatch) {
    const timestampMs = Number(syntheticMatch[1])
    const entries = state.session.sessionManager.getEntries()
    const match = entries.find((e) => {
      if (e.type !== 'message') return false
      const msg = e.message as { timestamp?: number }
      return typeof msg.timestamp === 'number' && msg.timestamp === timestampMs
    })
    if (!match) {
      throw new Error(
        `Cannot fork: no session entry found with timestamp ${timestampMs} (id: ${cmd.entryId}). The message may still be streaming.`
      )
    }
    forkEntryId = match.id
  }

  await startSession(state.cwd, {
    sessionFile: state.session.sessionFile ?? undefined,
    forkEntryId,
    requestId: cmd.requestId,
    workspaceTrusted: cmd.workspaceTrusted,
  })
}

export async function handleNavigateTreeCommand(
  cmd: Extract<SidecarCommand, { type: 'navigate_tree' }>
): Promise<void> {
  const state = getState()
  if (!state) {
    send({ type: 'error', requestId: cmd.requestId, message: 'No active session' })
    return
  }
  // Pi's own tree navigation: moves the leaf pointer in this file (no fork),
  // rebuilds the agent context from the new leaf, and reports the target
  // user message text so the composer can offer it for editing.
  const result = await state.session.navigateTree(cmd.entryId)
  send({
    type: 'navigate_tree_result',
    requestId: cmd.requestId,
    result: {
      cancelled: result.cancelled,
      leafId: state.session.sessionManager.getLeafId(),
      editorText: result.editorText,
    },
  })
}

export async function handleStopCommand(
  _cmd: Extract<SidecarCommand, { type: 'stop' }>
): Promise<void> {
  const state = getState()
  if (state) {
    state.unsubscribe()
    await stopSession(state.session, 'quit')
    setState(null)
  }
  send({ type: 'stopped' })
  setTimeout(() => process.exit(0), 100)
}
