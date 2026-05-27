import { type Component, createSignal, Show } from 'solid-js'
import { labelForTool } from '../../lib/sessionView'
import type { ToolCard } from '../../types/session'
import { ToolTypeIcon } from './ToolIcon'
import { extractCommand, MAX_CMD } from './toolCardHelpers'

type GenericToolRowProps = {
  card: ToolCard
}

export const GenericToolRow: Component<GenericToolRowProps> = (props) => {
  const [open, setOpen] = createSignal(false)
  const preview = () => extractCommand(props.card)
  const isTruncated = () => preview().length > MAX_CMD
  const displayPreview = () => (isTruncated() ? `${preview().slice(0, MAX_CMD)}…` : preview())
  const hasOutput = () => !!props.card.output?.trim()

  return (
    <div class="tool-row">
      <button
        type="button"
        class="tool-ran-header"
        onClick={() => hasOutput() && setOpen((v) => !v)}
        style={{ cursor: hasOutput() ? 'pointer' : 'default' }}
      >
        <ToolTypeIcon
          toolName={props.card.toolName}
          streaming={props.card.streaming}
          isError={props.card.isError}
        />
        <span class="tool-ran-label">{labelForTool(props.card.toolName)}</span>
        <span class="tool-ran-preview">{displayPreview()}</span>
        <Show when={props.card.streaming}>
          <span class="tool-streaming-dot">·</span>
        </Show>
        <Show when={hasOutput() && !props.card.streaming}>
          <span class="tool-chevron" aria-hidden="true">
            {open() ? '⌄' : '›'}
          </span>
        </Show>
      </button>
      <Show when={open() && hasOutput()}>
        <div class="tool-output-connector">
          <div class={`tool-ran-output ${props.card.isError ? 'is-error' : ''}`}>
            <pre>{props.card.output || JSON.stringify(props.card.args, null, 2)}</pre>
          </div>
        </div>
      </Show>
    </div>
  )
}
