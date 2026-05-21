import type { Component } from 'solid-js'
import type { QueueMode } from './types'

interface ComposerHintProps {
  shellMode: boolean
  isStreaming: boolean
  queueMode: QueueMode
}

export const ComposerHint: Component<ComposerHintProps> = (props) => {
  return (
    <p class="composer-hint">
      {props.shellMode
        ? 'enter to run shell · esc cancel · ⌘⇧X shell mode'
        : props.isStreaming && !props.shellMode
          ? props.queueMode === 'steer'
            ? 'interrupt mode · injects after tool calls · enter to send · alt+enter switch'
            : props.queueMode === 'followup'
              ? 'queue mode · delivers when agent stops · enter to send · alt+enter switch'
              : 'enter to send · alt+enter switch delivery mode'
          : 'enter to send · shift+enter new line · ↑ recall last · ⌘/ add context · ⌘⇧X shell'}
    </p>
  )
}
