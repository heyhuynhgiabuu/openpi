/**
 * pwa/LiveView — the live agent stream, straight from /api/events.
 *
 * Shows the newest events first (phones scroll top-down); tool calls include
 * a one-line argument preview. The stream itself lives in sse.ts.
 */
import { For, Show, createSignal, onCleanup, onMount } from 'solid-js'
import { openEventStream, type SseStatus } from './sse'

interface LiveEvent {
  key: number
  type: string
  summary: string
  detail?: string
}

const VISIBLE = ['agent_start', 'agent_end', 'tool_execution_start', 'tool_execution_end']

function summarize(
  type: string,
  data: Record<string, unknown>
): { summary: string; detail?: string } {
  if (type === 'agent_start') return { summary: 'Agent started' }
  if (type === 'agent_end') {
    const error = typeof data.finalError === 'string' ? data.finalError : undefined
    return { summary: error ? `Agent failed: ${error}` : 'Agent finished' }
  }
  if (type.startsWith('tool_execution')) {
    const tool = typeof data.toolName === 'string' ? data.toolName : 'tool'
    const args =
      typeof data.args === 'object' && data.args !== null ? JSON.stringify(data.args) : ''
    return {
      summary: `${type === 'tool_execution_start' ? '→' : '✓'} ${tool}`,
      detail: args ? args.slice(0, 140) : undefined,
    }
  }
  if (type === 'queue_update') return { summary: 'Message queue updated' }
  return { summary: type }
}

const STATUS_LABEL: Record<SseStatus, string> = {
  connecting: 'connecting…',
  connected: 'streaming',
  reconnecting: 'reconnecting…',
  closed: 'offline',
}

export function LiveView() {
  const [events, setEvents] = createSignal<LiveEvent[]>([])
  const [status, setStatus] = createSignal<SseStatus>('connecting')
  let counter = 0

  onMount(() => {
    const close = openEventStream((frame) => {
      const data = (frame.data ?? {}) as Record<string, unknown>
      if (!VISIBLE.includes(frame.event)) return
      const { summary, detail } = summarize(frame.event, data)
      setEvents((previous) =>
        [{ key: ++counter, type: frame.event, summary, detail }, ...previous].slice(0, 100)
      )
    }, setStatus)
    onCleanup(close)
  })

  return (
    <div>
      <div class="row">
        <h1>Live</h1>
        <span
          class="badge"
          role="status"
          aria-live="polite"
          classList={{ live: status() === 'connected' }}
        >
          {STATUS_LABEL[status()]}
        </span>
      </div>
      <Show when={events().length === 0}>
        <p class="muted">Waiting for agent activity…</p>
      </Show>
      <For each={events()}>
        {(event) => (
          <div class="event">
            <span class="type">{event.type}</span> {event.summary}
            <Show when={event.detail}>
              <div class="toolargs">{event.detail}</div>
            </Show>
          </div>
        )}
      </For>
    </div>
  )
}
