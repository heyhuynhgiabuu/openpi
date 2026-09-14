import { batch, createSignal, onCleanup, onMount } from 'solid-js'
import type { AgentReviewChange, AgentReviewSummary } from '../lib/ipc'

export function useAgentReviewChanges() {
  const [changes, setChanges] = createSignal<AgentReviewChange[]>([])
  const [activeId, setActiveId] = createSignal<string | null>(null)
  const [error, setError] = createSignal<string | null>(null)

  const applyChanges = (next: AgentReviewChange[]) => {
    batch(() => {
      setChanges(next)
      setActiveId((current) => {
        if (current && next.some((change) => change.id === current)) return current
        return next[0]?.id ?? null
      })
    })
  }

  const applySummary = (summary: AgentReviewSummary) => {
    applyChanges(summary.changes)
    setError(null)
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
    get activeId() {
      return activeId()
    },
    get activeChange() {
      const id = activeId()
      return changes().find((change) => change.id === id) ?? changes()[0] ?? null
    },
    get error() {
      return error()
    },
    setActiveId,
    keep,
    revert,
    keepHunk,
    revertHunk,
    revertAll,
    clear,
    refresh,
  }
}
