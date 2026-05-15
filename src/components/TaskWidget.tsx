import { Check, ChevronDown, ChevronRight } from 'lucide-solid'
import { createSignal, For, Show } from 'solid-js'
import type { TrackedTask } from '../lib/extensionTrackers'

interface Props {
  tasks: TrackedTask[]
}

export function TaskWidget(props: Props) {
  const [collapsed, setCollapsed] = createSignal(false)

  const total = () => props.tasks.length
  const done = () => props.tasks.filter((t) => t.status === 'completed').length

  return (
    <Show when={props.tasks.length > 0}>
      <div class="task-widget">
        <button type="button" class="task-widget-header" onClick={() => setCollapsed((c) => !c)}>
          <span class="task-widget-summary">
            {done()} of {total()} task{total() !== 1 ? 's' : ''} completed
          </span>
          <Show
            when={collapsed()}
            fallback={<ChevronDown size={12} strokeWidth={2} class="task-widget-chevron" />}
          >
            <ChevronRight size={12} strokeWidth={2} class="task-widget-chevron" />
          </Show>
        </button>

        <Show when={!collapsed()}>
          <ul class="task-list">
            <For each={props.tasks}>
              {(task) => (
                <li class={`task-row task-row--${task.status}`}>
                  <span class="task-icon">
                    <Show when={task.status === 'completed'}>
                      <Check size={11} strokeWidth={2.5} class="task-icon-done" />
                    </Show>
                    <Show when={task.status === 'in_progress'}>
                      <span class="task-icon-active" />
                    </Show>
                    <Show when={task.status === 'pending'}>
                      <span class="task-icon-pending" />
                    </Show>
                  </span>
                  <span class="task-subject">
                    <Show
                      when={task.status === 'in_progress' && task.activeForm}
                      fallback={task.subject}
                    >
                      {task.activeForm}
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
