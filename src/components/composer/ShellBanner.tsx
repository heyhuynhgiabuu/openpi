import { TerminalSquare } from 'lucide-solid'
import { type Component, Show } from 'solid-js'

interface ShellBannerProps {
  shellMode: boolean
  onCancel: () => void
}

export const ShellBanner: Component<ShellBannerProps> = (props) => {
  return (
    <Show when={props.shellMode}>
      <div class="composer-shell-banner">
        <span class="composer-shell-label">
          <TerminalSquare size={13} /> Shell
        </span>
        <button type="button" class="composer-shell-cancel" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </Show>
  )
}
