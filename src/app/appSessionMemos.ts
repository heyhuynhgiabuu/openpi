/**
 * Session-derived memos for the App render tree. Call inside the
 * Show-callback scope where `getReady` is the non-null ready accessor —
 * memos register with the nearest owner, same as the inline originals.
 */

import { createMemo } from 'solid-js'
import type { useOpenPiSession } from '../hooks/useOpenPiSession'

type ReadyAccessor = () => NonNullable<ReturnType<typeof useOpenPiSession>['ready']>

export function createAppSessionMemos(
  session: ReturnType<typeof useOpenPiSession>,
  getReady: ReadyAccessor
) {
  // getReady() is called once — NOT reactive on its own. Wrap every derived
  // value in createMemo so they recompute when session.ready changes (e.g.
  // after picking a new workspace or resuming a different session).
  const cwd = createMemo(() => getReady().cwd)
  const workspaceName = createMemo(() => cwd().split('/').pop() ?? cwd())
  const activeSessionPath = createMemo(() => getReady().sessionFile)
  const displayName = createMemo(
    () =>
      session.sessionName ??
      (activeSessionPath()
        ? (activeSessionPath()!.split('/').pop()?.replace('.jsonl', '') ?? 'session')
        : 'new session')
  )
  const promptHistory = createMemo(() =>
    session.messages
      .filter((message) => message.role === 'user' && message.text.trim().length > 0)
      .map((message) => message.text)
      .reverse()
  )
  const remotePreemptedByLocal = createMemo(
    () => session.localActivityAt > 0 && session.remoteSessionUpdatedAt <= session.localActivityAt
  )
  const showingRemoteSession = createMemo(() =>
    Boolean(
      !session.isStreaming &&
      !remotePreemptedByLocal() &&
      session.remoteSessionStatus?.sessionFile &&
      session.remoteSessionMessages.length > 0
    )
  )
  const conversationMessages = createMemo(() =>
    showingRemoteSession() ? session.remoteSessionMessages : session.messages
  )
  const conversationStreaming = createMemo(
    () =>
      session.isStreaming ||
      (!remotePreemptedByLocal() && session.remoteSessionStatus?.status === 'running')
  )
  const showRemoteSessionBar = createMemo(() =>
    Boolean(
      !remotePreemptedByLocal() &&
      (session.remoteSessionStatus?.status === 'running' || showingRemoteSession())
    )
  )

  return {
    cwd,
    workspaceName,
    activeSessionPath,
    displayName,
    promptHistory,
    remotePreemptedByLocal,
    showingRemoteSession,
    conversationMessages,
    conversationStreaming,
    showRemoteSessionBar,
  }
}

export type AppSessionMemos = ReturnType<typeof createAppSessionMemos>
