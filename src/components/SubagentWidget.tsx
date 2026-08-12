import { For, Show } from 'solid-js'
import type { TrackedTask } from '../lib/extensionTrackers'
import { formatTaskDurationMs } from '../lib/taskToolHelpers'

/**
 * Live tasks tray — follows opencode-desktop v2 minimal style:
 * - No chrome (no card, no border) — sits inline in the conversation
 * - Trigger-level: `agent · elapsed · description`
 * - Compact single line per task, monospace ids
 */
export function SubagentWidget(props: { tasks: TrackedTask[] }) {
  const active = () => props.tasks.filter((t) => t.status === 'running' || t.status === 'queued')

  return (
    <Show when={active().length > 0}>
      <div data-component="subagent-widget" data-pending>
        <div data-slot="subagent-header">
          <span data-slot="subagent-title">Tasks</span>
          <span data-slot="subagent-count">{active().length}</span>
        </div>

        <div data-slot="subagent-list">
          <For each={active()}>
            {(task) => (
              <div
                data-slot="subagent-item"
                data-status={task.status}
                data-bg={task.background || undefined}
              >
                <Show
                  when={task.background}
                  fallback={<span data-slot="subagent-item-mode">foreground</span>}
                >
                  <span data-slot="subagent-item-mode" data-bg>
                    background
                  </span>
                </Show>

                <span data-slot="subagent-item-agent">{task.agentType}</span>

                <span data-slot="subagent-item-elapsed">
                  {formatTaskDurationMs(Date.now() - task.startedAt)}
                </span>

                <Show when={task.description}>
                  <span data-slot="subagent-item-sep">·</span>
                  <span data-slot="subagent-item-desc" title={task.description}>
                    {task.description}
                  </span>
                </Show>

                <Show when={task.taskId}>
                  <span data-slot="subagent-item-id">{task.taskId}</span>
                </Show>
              </div>
            )}
          </For>
        </div>
      </div>
    </Show>
  )
}
