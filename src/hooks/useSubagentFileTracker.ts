/**
 * useSubagentFileTracker — SolidJS hook for the sub-agent artifact list.
 *
 * Subscribes to `ARTIFACT_UPDATE` IPC events from
 * `electron/services/artifactWatcher.ts` and exposes the current
 * snapshot as a Solid signal.
 */
import { createSignal, onCleanup } from 'solid-js'
import type { SubagentArtifact, TodoListFile } from '../lib/ipc/_full'
import { SubagentFileTracker } from '../lib/subagentFileTracker'

export function useSubagentFileTracker() {
  const tracker = new SubagentFileTracker()
  const [artifacts, setArtifacts] = createSignal<SubagentArtifact[]>(tracker.snapshot())
  const [todoFiles, setTodoFiles] = createSignal<TodoListFile[]>([])

  const unsubscribe = window.openpi?.onArtifactUpdate?.((payload) => {
    if (tracker.apply(payload.artifacts)) {
      setArtifacts(tracker.snapshot())
    }
    setTodoFiles(payload.todoFiles ?? [])
  })

  onCleanup(() => {
    unsubscribe?.()
  })

  return {
    artifacts,
    todoFiles,
    clear: () => {
      tracker.clear()
      setArtifacts([])
      setTodoFiles([])
    },
  }
}
