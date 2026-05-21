import { Check, Copy, GitBranch } from 'lucide-solid'
import { createSignal, onCleanup, Show } from 'solid-js'

interface MessageActionsProps {
  messageId: string
  getText: () => string
  streaming?: boolean
  onFork?: (id: string) => void
}

export function MessageActions(props: MessageActionsProps) {
  const [copied, setCopied] = createSignal(false)
  let copiedTimer: ReturnType<typeof setTimeout> | undefined

  onCleanup(() => {
    if (copiedTimer) clearTimeout(copiedTimer)
  })

  const handleCopy = () => {
    void navigator.clipboard.writeText(props.getText())
    setCopied(true)
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => setCopied(false), 1800)
  }

  return (
    <Show when={!props.streaming}>
      <div class="message-actions">
        <button type="button" class="msg-action-btn" onClick={handleCopy} title="Copy text">
          <Show when={copied()} fallback={<Copy size={12} />}>
            <Check size={12} />
          </Show>
        </button>
        <Show when={props.onFork}>
          <button
            type="button"
            class="msg-action-btn fork-btn"
            onClick={() => props.onFork?.(props.messageId)}
            title="Fork conversation from here"
          >
            <GitBranch size={12} />
            <span>fork</span>
          </button>
        </Show>
      </div>
    </Show>
  )
}
