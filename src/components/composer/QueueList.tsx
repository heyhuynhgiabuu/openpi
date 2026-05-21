import { Clock, Zap } from 'lucide-solid'
import { type Component, createMemo, For, Show } from 'solid-js'
import { truncate } from './helpers'

interface QueueListProps {
  steeringQueue: string[]
  followUpQueue: string[]
}

export const QueueList: Component<QueueListProps> = (props) => {
  const hasQueue = createMemo(
    () => props.steeringQueue.length > 0 || props.followUpQueue.length > 0
  )

  return (
    <Show when={hasQueue()}>
      <div class="pending-queue">
        <div class="pending-queue-header">
          <span class="pending-queue-count">
            Queued · {props.steeringQueue.length + props.followUpQueue.length}
          </span>
        </div>
        <For each={props.steeringQueue}>
          {(item) => (
            <div class="pq-row">
              <span
                class="pq-badge pq-badge--steer"
                title="Interrupt — injected after current tool calls"
              >
                <Zap size={10} />
              </span>
              <span class="pq-text" title={item}>
                {truncate(item, 72)}
              </span>
            </div>
          )}
        </For>
        <For each={props.followUpQueue}>
          {(item) => (
            <div class="pq-row">
              <span
                class="pq-badge pq-badge--followup"
                title="Queue — delivered when agent fully stops"
              >
                <Clock size={10} />
              </span>
              <span class="pq-text" title={item}>
                {truncate(item, 72)}
              </span>
            </div>
          )}
        </For>
      </div>
    </Show>
  )
}
