import { createMemo, Show } from 'solid-js'
import type { SessionHistoryMessage } from '../../lib/ipc'

export type UsageMetrics = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  total: number
  durationMs: number
  tps: number | null
  cost: number
}

export function usageTotal(message: SessionHistoryMessage): number {
  return (
    message.totalTokens ??
    (message.inputTokens ?? 0) +
      (message.outputTokens ?? 0) +
      (message.cacheReadTokens ?? 0) +
      (message.cacheWriteTokens ?? 0)
  )
}

export function aggregateUsage(messages: SessionHistoryMessage[]): UsageMetrics {
  const input = messages.reduce((sum, msg) => sum + (msg.inputTokens ?? 0), 0)
  const output = messages.reduce((sum, msg) => sum + (msg.outputTokens ?? 0), 0)
  const cacheRead = messages.reduce((sum, msg) => sum + (msg.cacheReadTokens ?? 0), 0)
  const cacheWrite = messages.reduce((sum, msg) => sum + (msg.cacheWriteTokens ?? 0), 0)
  const total = messages.reduce((sum, msg) => sum + usageTotal(msg), 0)
  const durationMs = messages.reduce((sum, msg) => sum + (msg.durationMs ?? 0), 0)
  const tps = durationMs > 0 && output > 0 ? output / (durationMs / 1000) : null
  const cost = messages.reduce((sum, msg) => sum + (msg.cost ?? 0), 0)
  return { input, output, cacheRead, cacheWrite, total, durationMs, tps, cost }
}

function formatRuntime(ms: number): string {
  if (ms <= 0) return ''
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.round(seconds % 60)
  return `${minutes}m ${remainder}s`
}

export function UsageRow(props: { modelName?: string; metrics: UsageMetrics }) {
  return (
    <div class="message-usage">
      <Show when={props.modelName}>
        <span class="message-usage-model">{props.modelName}</span>
      </Show>
      <span>out {props.metrics.output.toLocaleString()}</span>
      <span>in {props.metrics.input.toLocaleString()}</span>
      <span>
        {`cache r/w ${props.metrics.cacheRead.toLocaleString()}/${props.metrics.cacheWrite.toLocaleString()}`}
      </span>
      <span>total {props.metrics.total.toLocaleString()}</span>
      <Show when={props.metrics.durationMs > 0}>
        <span>{formatRuntime(props.metrics.durationMs)}</span>
      </Show>
      <Show when={props.metrics.cost > 0}>
        <span>${props.metrics.cost.toFixed(4)}</span>
      </Show>
    </div>
  )
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 4))
}

export function LiveUsageRow(props: { text: string; modelName?: string }) {
  const estTokens = createMemo(() => estimateTokens(props.text))
  return (
    <div class="message-usage message-usage--streaming">
      <Show when={props.modelName}>
        <span class="message-usage-model">{props.modelName}</span>
      </Show>
      <span class="message-usage-live">
        generating&nbsp;~{estTokens().toLocaleString()}&nbsp;tok
      </span>
    </div>
  )
}
