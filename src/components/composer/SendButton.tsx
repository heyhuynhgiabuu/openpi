import { ArrowUp, Square } from 'lucide-solid'
import { type Component, Show } from 'solid-js'

interface SendButtonProps {
  isStreaming: boolean
  isShellRunning: boolean
  shellMode: boolean
  input: string
  attachedFilesCount: number
  lineCommentsCount: number
  loadedSkillsCount: number
  onSend: () => void
  onShellSend: () => void
  onAbort: () => void
}

export const SendButton: Component<SendButtonProps> = (props) => {
  return (
    <Show
      when={props.isStreaming}
      fallback={
        <button
          type="button"
          class="composer-send-btn"
          onClick={() => (props.shellMode ? props.onShellSend() : props.onSend())}
          disabled={
            props.shellMode
              ? !props.input.trim() || props.isShellRunning
              : !props.input.trim() &&
                props.attachedFilesCount === 0 &&
                props.lineCommentsCount === 0 &&
                props.loadedSkillsCount === 0
          }
          title={props.shellMode ? 'Run shell command (Enter)' : 'Send (Enter)'}
        >
          <ArrowUp size={14} strokeWidth={2.5} />
        </button>
      }
    >
      {/* During streaming: only the stop button */}
      <button type="button" class="composer-stop-btn" onClick={props.onAbort} title="Stop agent">
        <Square size={13} strokeWidth={2} />
      </button>
    </Show>
  )
}
