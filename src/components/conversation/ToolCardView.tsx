import type { Component } from 'solid-js'
import type { DisplayPreferences } from '../../lib/displayPreferences'
import type { ToolCard } from '../../types/session'
import { EditToolRow } from './EditToolRow'
import { FileToolRow } from './FileToolRow'
import { GenericToolRow } from './GenericToolRow'

import { ShellToolRow } from './ShellToolRow'
import { TaskToolRow } from './TaskToolRow'

const SHELL_TOOLS = new Set(['bash', 'sh', 'computer_bash', 'run_command'])
const EDIT_TOOLS = new Set(['edit', 'multiedit', 'write', 'patch', 'apply_patch'])
const FILE_TOOLS = new Set(['read'])
const TASK_TOOLS = new Set(['task'])

export interface ToolCardViewProps {
  card: ToolCard
  onFileClick?: (relativePath: string) => void
  onOpenSubSession?: (taskId: string | null) => void
  resolveTaskId?: (card: ToolCard) => string | null
  resolveTaskStatus?: (taskId: string | null) => 'running' | 'done' | 'error' | null
  displayPreferences: DisplayPreferences
  shimmerActive: boolean
}

export const ToolCardView: Component<ToolCardViewProps> = (props) => {
  const shimmerClass = () => `tool-shimmer-scope${props.shimmerActive ? ' is-tool-shimmering' : ''}`

  if (SHELL_TOOLS.has(props.card.toolName))
    return (
      <div class={shimmerClass()}>
        <ShellToolRow
          card={props.card}
          shimmerActive={props.shimmerActive}
          displayPreferences={props.displayPreferences}
        />
      </div>
    )
  if (EDIT_TOOLS.has(props.card.toolName)) {
    return (
      <div class={shimmerClass()}>
        <EditToolRow
          card={props.card}
          shimmerActive={props.shimmerActive}
          onFileClick={props.onFileClick}
          displayPreferences={props.displayPreferences}
        />
      </div>
    )
  }
  if (TASK_TOOLS.has(props.card.toolName)) {
    return (
      <div class={shimmerClass()}>
        <TaskToolRow
          card={props.card}
          onOpenSubSession={props.onOpenSubSession}
          resolveTaskId={props.resolveTaskId}
          resolveTaskStatus={props.resolveTaskStatus}
        />
      </div>
    )
  }
  if (FILE_TOOLS.has(props.card.toolName)) {
    return (
      <div class={shimmerClass()}>
        <FileToolRow
          card={props.card}
          shimmerActive={props.shimmerActive}
          onFileClick={props.onFileClick}
        />
      </div>
    )
  }
  return (
    <div class={shimmerClass()}>
      <GenericToolRow card={props.card} shimmerActive={props.shimmerActive} />
    </div>
  )
}
