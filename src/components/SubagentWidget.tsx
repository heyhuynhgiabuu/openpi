import { ChevronDown, ChevronRight, X } from 'lucide-solid'
import { animate } from 'motion'
import { createEffect, createSignal, For, on, onCleanup, Show } from 'solid-js'
import type { TrackedAgent } from '../lib/extensionTrackers'

interface Props {
  agents: TrackedAgent[]
}

const LINGER_MS = 4000

function elapsed(startedAt: number, now: number): string {
  const s = Math.floor((now - startedAt) / 1000)
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

function agentKey(agent: TrackedAgent): string {
  return agent.agentId ?? agent.tempId
}

function resultPreview(agent: TrackedAgent): string | undefined {
  return agent.error ?? agent.result
}

export function SubagentWidget(props: Props) {
  let widgetRef!: HTMLDivElement
  const [collapsed, setCollapsed] = createSignal(false)
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set())
  // Local snapshot — keeps the last non-empty list visible during linger
  const [display, setDisplay] = createSignal<TrackedAgent[]>([])
  const [now, setNow] = createSignal(Date.now())
  let lingerTimer: ReturnType<typeof setTimeout> | null = null
  let tickTimer: ReturnType<typeof setInterval> | null = null

  const running = () =>
    display().filter((a) => a.status === 'running' || a.status === 'queued').length
  const total = () => display().length

  function startExit() {
    animate(widgetRef, { opacity: 0, y: 40, scale: 0.98 }, { duration: 0.24, ease: 'easeIn' }).then(
      () => setDisplay([])
    )
  }

  function dismissNow() {
    if (lingerTimer) {
      clearTimeout(lingerTimer)
      lingerTimer = null
    }
    startExit()
  }

  function toggleAgent(agent: TrackedAgent) {
    const key = agentKey(agent)
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Live elapsed ticker while any agent is running
  createEffect(() => {
    const hasRunning = display().some((a) => a.status === 'running' || a.status === 'queued')
    if (hasRunning && !tickTimer) {
      tickTimer = setInterval(() => setNow(Date.now()), 1000)
      onCleanup(() => {
        if (tickTimer) clearInterval(tickTimer)
        tickTimer = null
      })
    } else if (!hasRunning && tickTimer) {
      clearInterval(tickTimer)
      tickTimer = null
    }
  })

  // Track changes from props.agents
  createEffect(
    on(
      () => props.agents,
      (agents) => {
        if (agents.length > 0) {
          // New/updated agents — refresh display, cancel any pending linger exit
          if (lingerTimer) {
            clearTimeout(lingerTimer)
            lingerTimer = null
          }
          // Reset opacity/transform in case a previous exit was partially played
          if (widgetRef) {
            animate(widgetRef, { opacity: 1, y: 0, scale: 1 }, { duration: 0 })
          }
          setDisplay(agents)
        } else if (display().length > 0) {
          // Agents cleared externally (agent_end clearFinished) — linger then exit
          lingerTimer = setTimeout(startExit, LINGER_MS)
        }
      }
    )
  )

  return (
    <Show when={display().length > 0}>
      <div ref={widgetRef} class="subagent-widget">
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
          <span class="subagent-widget-header-actions">
            <Show when={running() === 0}>
              <button
                type="button"
                class="subagent-widget-dismiss"
                title="Dismiss"
                onClick={(e) => {
                  e.stopPropagation()
                  dismissNow()
                }}
              >
                <X size={11} strokeWidth={2} />
              </button>
            </Show>
            <Show
              when={collapsed()}
              fallback={<ChevronDown size={12} strokeWidth={2} class="subagent-chevron" />}
            >
              <ChevronRight size={12} strokeWidth={2} class="subagent-chevron" />
            </Show>
          </span>
        </button>

        <Show when={!collapsed()}>
          <ul class="subagent-list">
            <For each={display()}>
              {(agent, i) => {
                const key = () => agentKey(agent)
                const open = () => expanded().has(key())
                const preview = () => resultPreview(agent)
                return (
                  <li
                    class={`subagent-card subagent-card--${agent.status}`}
                    style={{ 'animation-delay': `${i() * 35}ms` }}
                  >
                    <button
                      type="button"
                      class="subagent-card-main"
                      onClick={() => toggleAgent(agent)}
                      title="Inspect subagent details"
                    >
                      <span class={`subagent-status-icon subagent-status-icon--${agent.status}`}>
                        {statusIcon(agent.status)}
                      </span>
                      <span class="subagent-info">
                        <span class="subagent-type">{agent.subagentType}</span>
                        <span class="subagent-desc">{agent.description}</span>
                      </span>
                      <span class="subagent-meta">
                        <Show when={agent.activity}>
                          <span class="subagent-activity">{agent.activity}</span>
                        </Show>
                        <Show when={agent.status === 'running'}>
                          <span class="subagent-elapsed">{elapsed(agent.startedAt, now())}</span>
                        </Show>
                        <Show when={agent.background}>
                          <span class="subagent-bg-badge">bg</span>
                        </Show>
                        <Show
                          when={open()}
                          fallback={
                            <ChevronRight size={11} strokeWidth={2} class="subagent-chevron" />
                          }
                        >
                          <ChevronDown size={11} strokeWidth={2} class="subagent-chevron" />
                        </Show>
                      </span>
                    </button>
                    <Show when={open()}>
                      <div class="subagent-details">
                        <div class="subagent-detail-grid">
                          <span>ID</span>
                          <code>{agent.agentId ?? 'pending'}</code>
                          <span>Status</span>
                          <code>{agent.status}</code>
                          <span>Turns</span>
                          <code>{agent.turns ?? 0}</code>
                          <span>Tools</span>
                          <code>{agent.toolCalls ?? 0}</code>
                        </div>
                        <Show when={preview()}>
                          {(text) => <pre class="subagent-result-preview">{text()}</pre>}
                        </Show>
                        <Show when={agent.agentId}>
                          <p class="subagent-detail-hint">
                            Inspect full output with <code>get_subagent_result</code> id{' '}
                            <code>{agent.agentId}</code>.
                          </p>
                        </Show>
                      </div>
                    </Show>
                  </li>
                )
              }}
            </For>
          </ul>
        </Show>
      </div>
    </Show>
  )
}
