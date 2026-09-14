import { type Component, createMemo, createSignal, Show } from 'solid-js'
import { labelForTool } from '../../lib/sessionView'
import {
  formatTaskDurationMs,
  isBackgroundHandoff,
  isValidPiTaskId,
  parseTaskDetails,
  type TaskToolDetails,
} from '../../lib/taskToolHelpers'
import type { ToolCard } from '../../types/session'
import { SessionProgressDot } from './SessionProgressDot'

type TaskToolRowProps = {
  card: ToolCard
  onOpenSubSession?: (taskId: string | null) => void
  resolveTaskId?: (card: ToolCard) => string | null
  resolveTaskStatus?: (taskId: string) => string | null
}

/** Result text shown inline; the sub-session holds the full transcript. */
const RESULT_PREVIEW_CHARS = 4000

export const TaskToolRow: Component<TaskToolRowProps> = (props) => {
  const [open, setOpen] = createSignal(false)
  const details = (): TaskToolDetails => parseTaskDetails(props.card.args, props.card.details)

  const taskId = createMemo<string | null>(() => {
    const id = details().task_id
    if (typeof id === 'string' && isValidPiTaskId(id)) return id
    if (props.resolveTaskId) {
      const resolved = props.resolveTaskId(props.card)
      if (typeof resolved === 'string' && isValidPiTaskId(resolved)) return resolved
    }
    return null
  })

  const artifactStatus = () => {
    const id = taskId()
    if (!id) return null
    return props.resolveTaskStatus?.(id) ?? null
  }

  const handoff = () =>
    isBackgroundHandoff(details(), props.card.output ?? '', props.card.streaming)

  const status = createMemo<'pending' | 'completed' | 'failed'>(() => {
    const artifact = artifactStatus()
    if (artifact === 'error' || artifact === 'failed') return 'failed'
    if (artifact === 'done' || artifact === 'completed') return 'completed'
    if (artifact === 'running') return 'pending'
    if (props.card.isError) return 'failed'
    if (props.card.streaming || (handoff() && !details().phase)) return 'pending'
    return 'completed'
  })

  const statusLabel = createMemo(() => {
    if (status() === 'pending') return 'running'
    if (status() === 'failed') return 'failed'
    return 'completed'
  })

  const progressStatus = (): 'running' | 'background' | null => {
    if (status() !== 'pending') return null
    return handoff() ? 'background' : 'running'
  }

  const title = createMemo(() => {
    return details().description ?? details().agent_type ?? labelForTool(props.card.toolName)
  })

  const canNavigate = () => Boolean(taskId() && props.onOpenSubSession)

  /** Everything the tool call reported about the run, minus the result text. */
  const facts = createMemo(() => {
    const d = details()
    const out: string[] = []
    if (d.phase) out.push(`phase ${d.phase}`)
    out.push(d.background ? 'background' : 'foreground')
    // parseTaskDetails already narrowed these to number | undefined.
    if (d.tool_uses !== undefined) {
      out.push(`${d.tool_uses} tool ${d.tool_uses === 1 ? 'call' : 'calls'}`)
    }
    if (d.duration_ms !== undefined) out.push(formatTaskDurationMs(d.duration_ms))
    if (d.conversation_id) out.push(`conversation ${d.conversation_id}`)
    if (d.tmux_session) out.push(`tmux ${d.tmux_session}`)
    return out
  })

  const result = () => props.card.output?.trim() ?? ''
  const resultPreview = () =>
    result().length > RESULT_PREVIEW_CHARS
      ? `${result().slice(0, RESULT_PREVIEW_CHARS)}…`
      : result()

  return (
    <div
      class={`tool-row task-tool${props.card.isError ? ' is-error' : ''}`}
      data-component="task-tool"
      data-status={status()}
    >
      <button
        type="button"
        class="tool-ran-header"
        aria-expanded={open()}
        title={open() ? 'Hide task details' : 'Show task details'}
        onClick={() => setOpen((value) => !value)}
      >
        <Show when={progressStatus()}>{(mode) => <SessionProgressDot status={mode()} />}</Show>
        <span class="tool-row-title">
          Task · {details().agent_type ?? 'agent'} · {title()}
        </span>
        <Show when={handoff()}>
          <span class="tool-row-meta">background</span>
        </Show>
        <Show when={taskId()}>
          <span class="tool-row-meta">id: {taskId()}</span>
        </Show>
        <span class="tool-row-status" data-status={status()}>
          {statusLabel()}
        </span>
        <span class="tool-chevron" data-open={open()} aria-hidden="true">
          {open() ? '⌄' : '›'}
        </span>
      </button>

      <Show when={open()}>
        <div class="tool-output-connector">
          <div class="task-tool-panel">
            <div class="task-tool-facts">{facts().join(' · ')}</div>
            <Show when={canNavigate()}>
              <button
                type="button"
                class="task-tool-open"
                onClick={() => props.onOpenSubSession?.(taskId())}
              >
                Open sub-session ›
              </button>
            </Show>
            <Show when={result()}>
              <div class={`tool-ran-output${props.card.isError ? ' is-error' : ''}`}>
                <pre>{resultPreview()}</pre>
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  )
}
