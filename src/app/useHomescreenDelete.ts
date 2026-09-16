/**
 * Two-step homescreen session delete: clicking delete opens a confirm modal
 * with the session title; confirming moves the file to the OS trash via IPC.
 * For active .jsonl files the IPC archives first, then trashes.
 */

import { createSignal } from 'solid-js'
import type { useOpenPiSession } from '../hooks/useOpenPiSession'

export function useHomescreenDelete(session: ReturnType<typeof useOpenPiSession>) {
  const [pendingDelete, setPendingDelete] = createSignal<{ path: string; title: string } | null>(
    null
  )

  const requestDeleteSession = (sessionPath: string) => {
    const target = session.sessions.find((s) => s.path === sessionPath)
    setPendingDelete({
      path: sessionPath,
      title: target?.title || 'Untitled session',
    })
  }

  const confirmDeleteSession = async () => {
    const target = pendingDelete()
    if (!target) return
    setPendingDelete(null)
    const result = await window.openpi.deleteSession(target.path)
    if (result.failed > 0) {
      console.warn(`[delete-session] failed to delete ${target.path}`)
    }
  }

  return { pendingDelete, setPendingDelete, requestDeleteSession, confirmDeleteSession }
}
