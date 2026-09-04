import type { Component } from 'solid-js'
import { Show } from 'solid-js'
import type { AwaitingPrompt } from '../../hooks/useOpenPiSession'
import { formatShortcut as shortcut } from '../../lib/shortcutFormat'
import type { QueueMode } from './types'

interface ComposerHintProps {
  shellMode: boolean
  isStreaming: boolean
  awaitingPrompt?: AwaitingPrompt | null
  queueMode: QueueMode
}

export const ComposerHint: Component<ComposerHintProps> = (props) => (
  <Show
    when={props.awaitingPrompt}
    keyed
    fallback={
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
    }
  >
    {(prompt) => (
      <p class="composer-hint" data-awaiting="true">
        waiting for your response — {prompt.title ?? 'extension prompt'} · answer in the dialog
        above
      </p>
    )}
  </Show>
)
