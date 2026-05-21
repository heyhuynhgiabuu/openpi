import { type Component, createSignal, Show } from 'solid-js'
import { labelForTool } from '../../lib/sessionView'
import type { ToolCard } from '../../types/session'
import { ToolTypeIcon } from './ToolIcon'
import { harnessActionForTool, parseGoalOutputSummary, parseHarnessTaskId } from './toolCardHelpers'

type HarnessToolRowProps = {
  card: ToolCard
}

export const HarnessToolRow: Component<HarnessToolRowProps> = (props) => {
  const [open, setOpen] = createSignal(false)
  const hasOutput = () => !!props.card.output?.trim()

  const targetName = () => {
    if (typeof props.card.args.name === 'string') return props.card.args.name
    if (typeof props.card.args.title === 'string') return props.card.args.title
    if (typeof props.card.args.intent === 'string') return props.card.args.intent
    if (typeof props.card.args.focus === 'string') return props.card.args.focus
    if (typeof props.card.args.area === 'string' && typeof props.card.args.behavior === 'string')
      return `${props.card.args.area}: ${props.card.args.behavior}`
    if (typeof props.card.args.area === 'string') return props.card.args.area
    return ''
  }
  const isLegacySpec = () => props.card.toolName.startsWith('spec_')
  const typeBadge = () => null
  const workflowBadge = () => null
  const taskId = () => parseHarnessTaskId(props.card)
  const outputSummary = () => parseGoalOutputSummary(props.card.toolName, props.card.output ?? '')
  const label = () => harnessActionForTool(props.card.toolName)

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
        <span class="harness-action-label">{label()}</span>
        <Show when={targetName()}>
          <span class="harness-name">{targetName()}</span>
        </Show>
        <Show when={isLegacySpec()}>
          <span class="harness-badge harness-badge--legacy">legacy</span>
        </Show>
        <Show when={typeBadge()}>
          <span
            class={`harness-badge harness-badge--${typeBadge() === 'feature' ? 'feature' : 'bugfix'}`}
          >
            {typeBadge()}
          </span>
        </Show>
        <Show when={workflowBadge()}>
          <span class="harness-badge harness-badge--workflow">{workflowBadge()}</span>
        </Show>
        <Show when={taskId()}>
          <span class="harness-badge harness-badge--task">{taskId()}</span>
        </Show>
        <Show when={outputSummary()}>
          <span class="harness-summary">{outputSummary()}</span>
        </Show>
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
            <pre>{props.card.output}</pre>
          </div>
        </div>
      </Show>
    </div>
  )
}

// ─── Ask tool row ──────────────────────────────────────────────────────────

interface AskQuestion {
  question: string
  header: string
  options: { label: string; description?: string }[]
  multiSelect: boolean
}
