import { type Component, For, Show } from 'solid-js'
import type { ToolCard } from '../../types/session'
import { ToolTypeIcon } from './ToolIcon'
import { parsePlanItems, planStatusLabel } from './toolCardHelpers'

type PlanToolRowProps = {
  card: ToolCard
}

export const PlanToolRow: Component<PlanToolRowProps> = (props) => {
  const items = () => parsePlanItems(props.card.args)
  const explanation = () => {
    const value = props.card.args.explanation
    return typeof value === 'string' ? value.trim() : ''
  }
  const completed = () => items().filter((item) => item.status === 'completed').length
  const inProgress = () => items().find((item) => item.status === 'in_progress')

  return (
    <div class="tool-row">
      <div class="tool-ran-header plan-tool-header">
        <ToolTypeIcon
          toolName={props.card.toolName}
          streaming={props.card.streaming}
          isError={props.card.isError}
        />
        <span class="tool-ran-label">Plan updated</span>
        <Show
          when={inProgress()}
          fallback={
            <span class="plan-tool-summary">
              {completed()} / {items().length} done
            </span>
          }
        >
          {(item) => <span class="plan-tool-summary">Now: {item().step}</span>}
        </Show>
        <Show when={props.card.streaming}>
          <span class="tool-streaming-dot">·</span>
        </Show>
      </div>

      <Show when={explanation()}>
        <div class="plan-tool-explanation">{explanation()}</div>
      </Show>

      <Show when={items().length > 0}>
        <ol class="plan-tool-list">
          <For each={items()}>
            {(item) => (
              <li class={`plan-tool-item plan-tool-item--${item.status}`}>
                <span class="plan-tool-marker" aria-hidden="true">
                  {item.status === 'completed' ? '✓' : item.status === 'in_progress' ? '•' : '○'}
                </span>
                <span class="plan-tool-step">{item.step}</span>
                <span class="plan-tool-status">{planStatusLabel(item.status)}</span>
              </li>
            )}
          </For>
        </ol>
      </Show>
    </div>
  )
}

// ── Harness / legacy spec tool row ──────────────────────────────────────
