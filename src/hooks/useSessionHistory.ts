import type { Setter } from 'solid-js'
import { batch, createSignal } from 'solid-js'
import type { Message } from '../types/session'

const HISTORY_PAGE_LIMIT = 200

/**
 * Combine a freshly read page with what the live event stream already added.
 *
 * The read is async, so a message can land live while it is in flight — a
 * resumed run's first output used to disappear when the page replaced the list.
 * Replacing with a plain concat is not the fix either: the same message can be
 * in both, and the ids differ (`entry.id` from the file, `u-`/`a-<timestamp>`
 * live), so neither id nor order can dedupe it.
 *
 * What does match is `(role, timestamp)`: the live event carries the message
 * payload that gets persisted, so the file records the same value. Messages the
 * file cannot carry (system notices, extension output) are always kept.
 */
export function mergeHistoryPage(page: Message[], live: Message[]): Message[] {
  const persisted = (
    message: Message
  ): message is Extract<Message, { role: 'user' | 'assistant' }> =>
    message.role === 'user' || message.role === 'assistant'
  const key = (message: { role: string; timestamp?: number }) =>
    message.timestamp === undefined ? null : `${message.role}:${message.timestamp}`

  const loaded = new Set<string>()
  for (const message of page) {
    const id = persisted(message) ? key(message) : null
    if (id !== null) loaded.add(id)
  }

  const kept = live.filter((message) => {
    if (!persisted(message)) return true
    const id = key(message)
    // No timestamp means no way to tell it apart from its own file copy; it was
    // added live after the read started, so it is the newer of the two.
    return id === null || !loaded.has(id)
  })

  return [...page, ...kept]
}

interface SessionHistoryOptions {
  setMessages: Setter<Message[]>
  setError: Setter<string | null>
  /**
   * Branch to read instead of the file's own leaf. Set right after a branch
   * switch, which moves Pi's leaf without writing an entry to the file.
   */
  getLeafId: () => string | null
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

  /**
   * `merge` keeps messages the live stream added while the read was in flight.
   * Use it only where the caller has just cleared the list (`session_ready`) —
   * everywhere else those "live" messages are actually the previous view, e.g.
   * the abandoned branch after navigating the session tree.
   *
   * `mode` is required on purpose: the default would let a new caller inherit a
   * choice it never considered, and the two wrong answers fail differently —
   * merging a stale view leaves the wrong conversation on screen, while
   * replacing loses a message until the next reload.
   */
  const loadInitialMessages = (sessionFile: string, mode: 'merge' | 'replace') => {
    latestSessionFile = sessionFile
    window.openpi
      .getSessionMessages(sessionFile, {
        limit: HISTORY_PAGE_LIMIT,
        leafId: options.getLeafId() ?? undefined,
      })
      .then((page) => {
        if (latestSessionFile !== sessionFile) return
        batch(() => {
          if (mode === 'replace') options.setMessages(page.messages)
          else options.setMessages((previous) => mergeHistoryPage(page.messages, previous))
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
        leafId: options.getLeafId() ?? undefined,
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
