import { X } from 'lucide-solid'
import { type Component, Show } from 'solid-js'

export type GoalStep = 'running' | 'idle' | null

type GoalBannerProps = {
  text: string | null
  step: GoalStep
  onDismiss: () => void
}

export const GoalBanner: Component<GoalBannerProps> = (props) => {
  return (
    <Show when={props.text}>
      <div class="goal-banner">
        <span class="goal-banner-text" title={props.text!}>
          {props.text!}
        </span>
        <Show when={props.step}>
          <span class={`goal-badge goal-badge--${props.step}`}>{props.step}</span>
        </Show>
        <button
          type="button"
          class="goal-banner-dismiss"
          onClick={props.onDismiss}
          aria-label="Dismiss goal"
        >
          <X size={12} strokeWidth={2.5} />
        </button>
      </div>
    </Show>
  )
}
