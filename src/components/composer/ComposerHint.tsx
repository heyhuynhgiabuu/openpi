import type { Component } from 'solid-js'
import { formatShortcut as shortcut } from '../../lib/shortcutFormat'
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
        ? `enter to run shell · esc cancel · ${shortcut('⌘⇧X', 'Ctrl+Shift+X')} shell mode`
        : props.isStreaming && !props.shellMode
          ? props.queueMode === 'steer'
            ? 'interrupt mode · injects after tool calls · enter to send · alt+enter switch'
            : props.queueMode === 'followup'
              ? 'queue mode · delivers when agent stops · enter to send · alt+enter switch'
              : 'enter to send · alt+enter switch delivery mode'
          : `enter to send · shift+enter new line · ↑ recall last · ${shortcut('⌘/', 'Ctrl+/')} add context · ${shortcut('⌘⇧X', 'Ctrl+Shift+X')} shell`}
    </p>
  )
}
