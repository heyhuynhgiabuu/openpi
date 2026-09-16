/**
 * Task-history polling: pi-task writes `.pi/task-session-history.json` at
 * task start; it is the most reliable source for linking a parent `task`
 * tool card to its child sub-session (the tracker's `taskId` is populated
 * from `tool_execution_end` details, which pi-task does not always emit).
 * Keep polling while the cwd is active because the file is outside the
 * artifact watcher, so no live event fires when the task id lands.
 */

import { createEffect, on, onCleanup } from 'solid-js'
import type { SessionReady } from '../../lib/ipc'
import type { TaskHistoryEntry } from '../../lib/taskHistory'

function taskHistorySignature(entries: TaskHistoryEntry[]): string {
  return entries
    .map((entry) => `${entry.id}:${entry.status ?? ''}:${entry.startedAt ?? ''}`)
    .join('|')
}

export function useTaskHistoryPolling(
  ready: () => SessionReady | null,
  setTaskHistory: (entries: TaskHistoryEntry[]) => void
): void {
  createEffect(
    on(ready, (r) => {
      const cwd = r?.cwd
      let disposed = false
      let signature = ''

      const refresh = async () => {
        if (!cwd || disposed) return
        try {
          const entries = (await window.openpi.readTaskSessionHistory({
            cwd,
          })) as TaskHistoryEntry[]
          if (disposed) return
          const nextSignature = taskHistorySignature(entries)
          if (nextSignature !== signature) {
            signature = nextSignature
            setTaskHistory(entries)
          }
        } catch {
          if (!disposed) setTaskHistory([])
        }
      }

      if (!cwd) {
        setTaskHistory([])
        return
      }

      void refresh()
      const timer = window.setInterval(() => {
        void refresh()
      }, 1000)

      onCleanup(() => {
        disposed = true
        window.clearInterval(timer)
      })
    })
  )
}
