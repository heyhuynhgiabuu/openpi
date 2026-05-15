import { ChevronDown, ChevronRight } from 'lucide-solid'
import { createSignal, For, Show } from 'solid-js'
import type { TrackedAgent } from '../lib/extensionTrackers'

interface Props {
  agents: TrackedAgent[]
}

function elapsed(startedAt: number): string {
  const s = Math.floor((Date.now() - startedAt) / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

function statusIcon(status: TrackedAgent['status']): string {
  switch (status) {
    case 'running':
      return '⠹'
    case 'completed':
      return '✓'
    case 'failed':
      return '✗'
    case 'queued':
      return '…'
  }
}

export function SubagentWidget(props: Props) {
  const [collapsed, setCollapsed] = createSignal(false)

  const running = () =>
    props.agents.filter((a) => a.status === 'running' || a.status === 'queued').length
  const total = () => props.agents.length

  return (
    <Show when={props.agents.length > 0}>
      <div class="subagent-widget">
        <button
          type="button"
          class="subagent-widget-header"
          onClick={() => setCollapsed((c) => !c)}
        >
          <span class="subagent-widget-dot" />
          <span class="subagent-widget-title">
            Agents
            <Show when={running() > 0}>
              <span class="subagent-badge subagent-badge--running">{running()} running</span>
            </Show>
            <Show when={running() === 0}>
              <span class="subagent-badge subagent-badge--done">{total()} done</span>
            </Show>
          </span>
          <Show
            when={collapsed()}
            fallback={<ChevronDown size={12} strokeWidth={2} class="subagent-chevron" />}
          >
            <ChevronRight size={12} strokeWidth={2} class="subagent-chevron" />
          </Show>
        </button>

        <Show when={!collapsed()}>
          <ul class="subagent-list">
            <For each={props.agents}>
              {(agent) => (
                <li class={`subagent-card subagent-card--${agent.status}`}>
                  <span class={`subagent-status-icon subagent-status-icon--${agent.status}`}>
                    {statusIcon(agent.status)}
                  </span>
                  <span class="subagent-info">
                    <span class="subagent-type">{agent.subagentType}</span>
                    <span class="subagent-desc">{agent.description}</span>
                  </span>
                  <span class="subagent-meta">
                    <Show when={agent.status === 'running'}>
                      <span class="subagent-elapsed">{elapsed(agent.startedAt)}</span>
                    </Show>
                    <Show when={agent.background}>
                      <span class="subagent-bg-badge">bg</span>
                    </Show>
                  </span>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </Show>
  )
}
