import { batch, createSignal, onCleanup, onMount } from 'solid-js'
import type { AgentReviewChange, AgentReviewSummary } from '../lib/ipc'

export function useAgentReviewChanges() {
  const [changes, setChanges] = createSignal<AgentReviewChange[]>([])
  const [error, setError] = createSignal<string | null>(null)

  const applySummary = (summary: AgentReviewSummary) => {
    batch(() => {
      setChanges(summary.changes)
      setError(null)
    })
  }

  /** Runs a review operation and applies the summary it returns; failures land in `error`. */
  const run = async (operation: () => Promise<AgentReviewSummary>): Promise<void> => {
    try {
      applySummary(await operation())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const refresh = () => run(() => window.openpi.agentReview.list())
  const keep = (id: string) => run(() => window.openpi.agentReview.keep(id))
  const revert = (id: string) => run(() => window.openpi.agentReview.revert(id))
  const keepHunk = (id: string, index: number) =>
    run(() => window.openpi.agentReview.keepHunk(id, index))
  const revertHunk = (id: string, index: number) =>
    run(() => window.openpi.agentReview.revertHunk(id, index))
  const revertAll = () => run(() => window.openpi.agentReview.revertAll())
  const clear = () => run(() => window.openpi.agentReview.clear())

  onMount(() => {
    const unsubscribe = window.openpi.agentReview.onChanged(applySummary)
    void refresh()
    onCleanup(unsubscribe)
  })

  return {
    get changes() {
      return changes()
    },
    get error() {
      return error()
    },
    keep,
    revert,
    keepHunk,
    revertHunk,
    revertAll,
    clear,
  }
}
