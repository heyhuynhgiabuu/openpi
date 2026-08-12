import { type Component, createMemo, Show } from 'solid-js'
import { labelForTool } from '../../lib/sessionView'
import {
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

export const TaskToolRow: Component<TaskToolRowProps> = (props) => {
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

  const handleClick = () => {
    if (canNavigate()) {
      props.onOpenSubSession?.(taskId())
    }
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleClick()
    }
  }

  return (
    <button
      type="button"
      class={`tool-row task-tool${props.card.isError ? ' is-error' : ''}`}
      data-component="task-tool"
      data-status={status()}
      disabled={!canNavigate()}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
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
      <Show when={canNavigate()}>
        <span class="tool-chevron" aria-hidden="true">
          ›
        </span>
      </Show>
    </button>
  )
}
