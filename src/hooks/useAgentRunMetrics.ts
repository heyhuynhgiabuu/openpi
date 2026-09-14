import { createSignal } from 'solid-js'
import { addTurnUsage, EMPTY_RUN_USAGE, type RunUsage } from '../lib/runUsage'

interface AgentRunMetrics {
  elapsedMs: number
  output: number
  tps: number
}

export function useAgentRunMetrics() {
  const [metrics, setMetrics] = createSignal<AgentRunMetrics | null>(null)
  const [usage, setUsage] = createSignal<RunUsage>(EMPTY_RUN_USAGE)
  let agentStartWallMs: number | null = null

  const start = () => {
    agentStartWallMs = Date.now()
    setMetrics(null)
    setUsage(EMPTY_RUN_USAGE)
  }

  /**
   * Folds a completed turn into the live run totals. `turn_end` carries the
   * assistant message, so tokens and cost land here before the run finishes —
   * the composer badge no longer has to wait for `agent_end`.
   */
  const addTurn = (event: unknown) => {
    setUsage((prev) => addTurnUsage(prev, event))
  }

  /** Wall-clock TPS for the run that just finished, from the accumulated usage. */
  const finish = () => {
    if (agentStartWallMs === null) return

    const elapsedMs = Date.now() - agentStartWallMs
    const output = usage().output
    if (elapsedMs > 0 && output > 0) {
      setMetrics({
        elapsedMs,
        output,
        tps: output / (elapsedMs / 1000),
      })
    }
    agentStartWallMs = null
  }

  return {
    metrics,
    usage,
    start,
    addTurn,
    finish,
  }
}
