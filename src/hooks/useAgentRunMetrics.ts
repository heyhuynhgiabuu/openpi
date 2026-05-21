import { createSignal } from 'solid-js'

interface AgentRunMetrics {
  elapsedMs: number
  output: number
  tps: number
}

function assistantOutputTokens(messages: unknown): number {
  if (!Array.isArray(messages)) return 0

  let output = 0
  for (const message of messages) {
    const record = message as Record<string, unknown>
    if (record.role !== 'assistant') continue

    const usage = record.usage as Record<string, unknown> | undefined
    if (usage && typeof usage.output === 'number') {
      output += usage.output
    }
  }
  return output
}

export function useAgentRunMetrics() {
  const [metrics, setMetrics] = createSignal<AgentRunMetrics | null>(null)
  let agentStartWallMs: number | null = null

  const start = () => {
    agentStartWallMs = Date.now()
    setMetrics(null)
  }

  const finish = (event: Record<string, unknown>) => {
    if (agentStartWallMs === null) return

    const elapsedMs = Date.now() - agentStartWallMs
    const output = assistantOutputTokens(event.messages)
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
    start,
    finish,
  }
}
