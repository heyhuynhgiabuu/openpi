import { type Component, Show } from 'solid-js'
import { labelForTool } from '../../lib/sessionView'
import type { ToolCard } from '../../types/session'
import { parseAskQuestions } from './toolCardHelpers'

type AskToolRowProps = {
  card: ToolCard
}

export const AskToolRow: Component<AskToolRowProps> = (props) => {
  const questions = () => parseAskQuestions(props.card.args)
  const questionCount = () => questions().length
  const isMulti = () => questions().some((q) => q.multiSelect)

  return (
    <div class={`tool-row${props.card.isError ? ' is-error' : ''}`}>
      <div class="tool-ran-header ask-tool-compact-header">
        <span class="tool-ran-label">{labelForTool(props.card.toolName)}</span>
        <span class="ask-question-badge">{isMulti() ? 'choose' : 'pick'}</span>
        <span class="ask-tool-compact-note">
          {questionCount()} question{questionCount() === 1 ? '' : 's'} shown in widget tray
        </span>
        <Show when={props.card.streaming}>
          <span class="tool-streaming-dot">·</span>
        </Show>
      </div>
    </div>
  )
}
