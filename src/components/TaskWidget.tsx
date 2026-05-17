import { Check, ChevronDown, ChevronRight, X } from 'lucide-solid'
import { animate } from 'motion'
import { createSignal, For, Show } from 'solid-js'
import type { TrackedTask } from '../lib/extensionTrackers'

interface Props {
  tasks: TrackedTask[]
  onDismiss?: () => void
}

export function TaskWidget(props: Props) {
  let widgetRef!: HTMLDivElement
  const [collapsed, setCollapsed] = createSignal(false)

  const total = () => props.tasks.length
  const done = () => props.tasks.filter((t) => t.status === 'completed').length
  const allDone = () => total() > 0 && done() === total()

  function dismiss() {
    animate(widgetRef, { opacity: 0, y: 40, scale: 0.98 }, { duration: 0.24, ease: 'easeIn' }).then(
      () => props.onDismiss?.()
    )
  }

  return (
    <Show when={props.tasks.length > 0}>
      <div ref={widgetRef} class="task-widget">
        <button type="button" class="task-widget-header" onClick={() => setCollapsed((c) => !c)}>
          <span class="task-widget-summary">
            {done()} of {total()} task{total() !== 1 ? 's' : ''} completed
          </span>
          <span class="task-widget-header-actions">
            <Show when={allDone()}>
              <button
                type="button"
                class="task-widget-dismiss"
                title="Dismiss"
                onClick={(e) => {
                  e.stopPropagation()
                  dismiss()
                }}
              >
                <X size={11} strokeWidth={2} />
              </button>
            </Show>
            <Show
              when={collapsed()}
              fallback={<ChevronDown size={12} strokeWidth={2} class="task-widget-chevron" />}
            >
              <ChevronRight size={12} strokeWidth={2} class="task-widget-chevron" />
            </Show>
          </span>
        </button>

        <Show when={!collapsed()}>
          <ul class="task-list">
            <For each={props.tasks}>
              {(task, i) => (
                <li
                  class={`task-row task-row--${task.status}`}
                  style={{ 'animation-delay': `${i() * 40}ms` }}
                >
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
