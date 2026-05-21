import type { Setter } from 'solid-js'
import { batch, createSignal } from 'solid-js'
import type { Message } from '../types/session'

const HISTORY_PAGE_LIMIT = 200

interface SessionHistoryOptions {
  setMessages: Setter<Message[]>
  setError: Setter<string | null>
}

export function useSessionHistory(options: SessionHistoryOptions) {
  const [hasMoreHistoryBefore, setHasMoreHistoryBefore] = createSignal(false)
  const [historyBeforeEntryId, setHistoryBeforeEntryId] = createSignal<string | null>(null)
  const [isLoadingOlderHistory, setIsLoadingOlderHistory] = createSignal(false)
  let latestSessionFile: string | null = null

  const reset = (sessionFile: string | null) => {
    latestSessionFile = sessionFile
    setHasMoreHistoryBefore(false)
    setHistoryBeforeEntryId(null)
  }

  const loadInitialMessages = (sessionFile: string) => {
    latestSessionFile = sessionFile
    window.openpi
      .getSessionMessages(sessionFile, { limit: HISTORY_PAGE_LIMIT })
      .then((page) => {
        if (latestSessionFile !== sessionFile) return
        batch(() => {
          options.setMessages(page.messages)
          setHasMoreHistoryBefore(page.hasMoreBefore)
          setHistoryBeforeEntryId(page.nextBeforeEntryId)
        })
      })
      .catch((err: unknown) => options.setError(err instanceof Error ? err.message : String(err)))
  }

  const loadOlderSessionMessages = async () => {
    const sessionFile = latestSessionFile
    const beforeEntryId = historyBeforeEntryId()
    if (!sessionFile || !beforeEntryId || isLoadingOlderHistory()) return

    setIsLoadingOlderHistory(true)
    try {
      const page = await window.openpi.getSessionMessages(sessionFile, {
        limit: HISTORY_PAGE_LIMIT,
        beforeEntryId,
      })
      if (latestSessionFile !== sessionFile) return
      options.setMessages((previous) => {
        const seen = new Set(previous.map((message) => message.id))
        return [...page.messages.filter((message) => !seen.has(message.id)), ...previous]
      })
      setHasMoreHistoryBefore(page.hasMoreBefore)
      setHistoryBeforeEntryId(page.nextBeforeEntryId)
    } catch (err) {
      options.setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsLoadingOlderHistory(false)
    }
  }

  return {
    hasMoreHistoryBefore,
    historyBeforeEntryId,
    isLoadingOlderHistory,
    reset,
    loadInitialMessages,
    loadOlderSessionMessages,
  }
}
