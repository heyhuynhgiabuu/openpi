/**
 * useSubagentFileTracker — SolidJS hook for the sub-agent artifact list.
 *
 * Subscribes to `ARTIFACT_UPDATE` IPC events from
 * `electron/services/artifactWatcher.ts` and exposes the current
 * snapshot as a Solid signal.
 */
import { createSignal, onCleanup } from 'solid-js'
import type { SubagentArtifact } from '../lib/ipc/_full'
import { SubagentFileTracker } from '../lib/subagentFileTracker'

export function useSubagentFileTracker() {
  const tracker = new SubagentFileTracker()
  const [artifacts, setArtifacts] = createSignal<SubagentArtifact[]>(tracker.snapshot())

  const unsubscribe = window.openpi?.onArtifactUpdate?.((payload) => {
    if (tracker.apply(payload.artifacts)) {
      setArtifacts(tracker.snapshot())
    }
  })

  onCleanup(() => {
    unsubscribe?.()
  })

  return {
    artifacts,
    clear: () => {
      tracker.clear()
      setArtifacts([])
    },
  }
}
