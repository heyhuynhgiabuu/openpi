import { batch, createSignal, onCleanup, onMount } from 'solid-js'
import type { AgentReviewChange } from '../lib/ipc'

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

  const refresh = async () => {
    try {
      const summary = await window.openpi.agentReview.list()
      applyChanges(summary.changes)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const keep = async (id: string) => {
    try {
      const summary = await window.openpi.agentReview.keep(id)
      applyChanges(summary.changes)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const revert = async (id: string) => {
    try {
      const summary = await window.openpi.agentReview.revert(id)
      applyChanges(summary.changes)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const revertAll = async () => {
    try {
      const summary = await window.openpi.agentReview.revertAll()
      applyChanges(summary.changes)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const clear = async () => {
    try {
      const summary = await window.openpi.agentReview.clear()
      applyChanges(summary.changes)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  onMount(() => {
    const unsubscribe = window.openpi.agentReview.onChanged((summary) => {
      applyChanges(summary.changes)
      setError(null)
    })
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
    revertAll,
    clear,
    refresh,
  }
}
