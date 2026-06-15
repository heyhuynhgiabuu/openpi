import { Check, Copy, GitBranch } from 'lucide-solid'
import { createSignal, onCleanup, Show } from 'solid-js'

interface MessageActionsProps {
  messageId: string
  getText: () => string
  streaming?: boolean
  onFork?: (id: string) => void
  modelName?: string
  durationMs?: number
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60000)
  const s = Math.round((ms % 60000) / 1000)
  return s > 0 ? `${m}m ${s}s` : `${m}m`
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
        <div class="ma-info">
          <Show when={props.modelName}>
            <span class="ma-model">{props.modelName}</span>
          </Show>
          <Show when={props.modelName && props.durationMs != null && props.durationMs > 0}>
            <span class="ma-dot" aria-hidden="true">
              ·
            </span>
          </Show>
          <Show when={props.durationMs != null && props.durationMs > 0}>
            <span class="ma-duration">{formatDuration(props.durationMs!)}</span>
          </Show>
        </div>
        <div class="ma-buttons">
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
      </div>
    </Show>
  )
}
