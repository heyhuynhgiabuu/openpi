/**
 * SubagentFileWidget — renders the list of in-flight and completed
 * sub-agent tasks written to `.pi/artifacts/task-<id>/` by the global
 * `~/.pi/agent/extensions/task/` delegator.
 *
 * Each entry shows: status icon, agent name, prompt preview, and a
 * collapsible result preview. Renders nothing when there are no
 * artifacts. Auto-collapses when all tasks are completed.
 */

import { CheckCircle2, Circle, CircleAlert, Loader2, X } from 'lucide-solid'
import { createMemo, createSignal, For, type JSX, Show } from 'solid-js'
import type { SubagentArtifact } from '../lib/ipc/_full'

interface SubagentFileWidgetProps {
  artifacts: SubagentArtifact[]
  onDismiss?: () => void
}

const STATUS_ICON: Record<SubagentArtifact['status'], () => JSX.Element> = {
  running: () => <Loader2 size={14} class="animate-spin" />,
  completed: () => <CheckCircle2 size={14} />,
  failed: () => <CircleAlert size={14} />,
}

const STATUS_COLOR: Record<SubagentArtifact['status'], string> = {
  running: 'var(--color-accent)',
  completed: 'var(--color-success)',
  failed: 'var(--color-danger)',
}

export function SubagentFileWidget(props: SubagentFileWidgetProps) {
  const [expandedIds, setExpandedIds] = createSignal<Set<string>>(new Set())
  const [dismissed, setDismissed] = createSignal(false)

  const visible = createMemo(() => {
    if (dismissed()) return []
    return props.artifacts.filter((a) => a.status === 'running')
  })

  const toggle = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleDismiss = () => {
    setDismissed(true)
    props.onDismiss?.()
  }

  return (
    <Show when={visible().length > 0}>
      <div class="subagent-file-widget" role="region" aria-label="Sub-agent tasks">
        <header class="subagent-file-widget__header">
          <span class="subagent-file-widget__title">Sub-agent tasks</span>
          <button
            type="button"
            class="subagent-file-widget__dismiss"
            aria-label="Dismiss task list"
            onClick={handleDismiss}
          >
            <X size={12} />
          </button>
        </header>
        <ul class="subagent-file-widget__list">
          <For each={visible()}>
            {(artifact) => (
              <li class="subagent-file-widget__item">
                <button
                  type="button"
                  class="subagent-file-widget__row"
                  onClick={() => toggle(artifact.id)}
                  aria-expanded={expandedIds().has(artifact.id)}
                >
                  <span
                    class="subagent-file-widget__icon"
                    style={{ color: STATUS_COLOR[artifact.status] }}
                  >
                    {STATUS_ICON[artifact.status]()}
                  </span>
                  <span class="subagent-file-widget__agent">{artifact.agent}</span>
                  <span class="subagent-file-widget__prompt">{artifact.prompt}</span>
                </button>
                <Show when={expandedIds().has(artifact.id) && artifact.result}>
                  <pre class="subagent-file-widget__result">{artifact.result}</pre>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </div>
    </Show>
  )
}

/**
 * SubagentFileTray — bottom-tray variant that also surfaces completed
 * and failed tasks. Used in the conversation workspace alongside
 * <SubagentFileWidget> when the user wants to see finished work.
 */
interface SubagentFileTrayProps {
  artifacts: SubagentArtifact[]
}

export function SubagentFileTray(props: SubagentFileTrayProps) {
  const items = createMemo(() => props.artifacts.slice(0, 5))
  return (
    <Show when={items().length > 0}>
      <div class="subagent-file-tray" role="status" aria-label="Recent sub-agent activity">
        <For each={items()}>
          {(a) => (
            <span
              class="subagent-file-tray__chip"
              style={{ color: STATUS_COLOR[a.status] }}
              title={`${a.agent}: ${a.prompt}`}
            >
              {STATUS_ICON[a.status]()}
              {a.agent}
            </span>
          )}
        </For>
      </div>
    </Show>
  )
}

// Re-export Circle for the empty state (used by the renderer when no
// artifacts are present and we want a neutral placeholder).
export { Circle }
