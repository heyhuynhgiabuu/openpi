import { type Component, createEffect, createSignal, Show } from 'solid-js'
import type { DisplayPreferences } from '../../lib/displayPreferences'
import { labelForTool } from '../../lib/sessionView'
import type { ToolCard } from '../../types/session'
import { extractCommand, MAX_CMD } from './toolCardHelpers'

type ShellToolRowProps = {
  card: ToolCard
  displayPreferences: DisplayPreferences
}

export const ShellToolRow: Component<ShellToolRowProps> = (props) => {
  const [open, setOpen] = createSignal(props.displayPreferences.expandShellToolParts)
  const [manualToggle, setManualToggle] = createSignal(false)

  // Sync preference → open state, but only while the user hasn't manually toggled this card
  createEffect(() => {
    if (!manualToggle()) setOpen(props.displayPreferences.expandShellToolParts)
  })

  const cmd = () => extractCommand(props.card)
  const isTruncated = () => cmd().length > MAX_CMD
  const displayCmd = () => (isTruncated() ? `${cmd().slice(0, MAX_CMD)}…` : cmd())
  const hasOutput = () => !!props.card.output?.trim()

  return (
    <div class={`tool-row${props.card.isError ? ' is-error' : ''}`}>
      <button
        type="button"
        class="tool-ran-header"
        onClick={() => {
          if (hasOutput()) {
            setManualToggle(true)
            setOpen((v) => !v)
          }
        }}
        title={isTruncated() ? cmd() : undefined}
        style={{ cursor: hasOutput() ? 'pointer' : 'default' }}
      >
        <span class="tool-ran-label">{labelForTool(props.card.toolName)}</span>
        <code class="tool-ran-cmd">{displayCmd()}</code>
        <Show when={props.card.streaming}>
          <span class="tool-streaming-dot">·</span>
        </Show>
        <Show when={hasOutput() && !props.card.streaming}>
          <span class="tool-chevron" data-open={open()} aria-hidden="true">
            {open() ? '⌄' : '›'}
          </span>
        </Show>
      </button>
      <Show when={open() && hasOutput()}>
        <div class="tool-output-connector">
          <div class={`tool-ran-output ${props.card.isError ? 'is-error' : ''}`}>
            <pre>{props.card.output}</pre>
          </div>
        </div>
      </Show>
    </div>
  )
}
