import { Clock, RotateCcw, Zap } from 'lucide-solid'
import { type Component, Show } from 'solid-js'
import type { QueueMode } from './types'

interface DeliveryModeProps {
  queueMode: QueueMode
  onQueueMode: (mode: QueueMode | ((mode: QueueMode) => QueueMode)) => void
}

export const DeliveryMode: Component<DeliveryModeProps> = (props) => {
  return (
    <>
      <div class="delivery-seg">
        <button
          type="button"
          class={`delivery-btn${props.queueMode === 'steer' ? ' is-on' : ''}`}
          onClick={() => props.onQueueMode((m) => (m === 'steer' ? 'prompt' : 'steer'))}
          title="Interrupt — injected after current tool calls, before next LLM call"
          aria-pressed={props.queueMode === 'steer'}
        >
          <Zap size={11} />
          <span>Interrupt</span>
        </button>
        <button
          type="button"
          class={`delivery-btn is-queue-variant${props.queueMode === 'followup' ? ' is-on' : ''}`}
          onClick={() => props.onQueueMode((m) => (m === 'followup' ? 'prompt' : 'followup'))}
          title="Queue — delivered when agent fully stops"
          aria-pressed={props.queueMode === 'followup'}
        >
          <Clock size={11} />
          <span>Queue</span>
        </button>
      </div>

      {/* Reset to normal prompt mode — shown when a delivery mode is active */}
      <Show when={props.queueMode !== 'prompt'}>
        <button
          type="button"
          class={`delivery-reset-btn${props.queueMode === 'steer' ? ' is-steer' : ' is-followup'}`}
          onClick={() => props.onQueueMode('prompt')}
          title={`Reset to normal prompt mode (${props.queueMode === 'steer' ? 'Alt+↑' : 'Alt+↓'} to re-activate)`}
          aria-label="Reset delivery mode to normal"
        >
          <RotateCcw size={11} strokeWidth={2} />
        </button>
      </Show>
    </>
  )
}
