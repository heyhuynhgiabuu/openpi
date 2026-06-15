// biome-ignore-all lint/a11y/useAriaPropsSupportedByRole lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: existing tool-card file chip interactions are tracked separately from this release.
import type { Component } from 'solid-js'
import type { DisplayPreferences } from '../../lib/displayPreferences'
import type { ToolCard } from '../../types/session'
import { AskToolRow } from './AskToolRow'
import { EditToolRow } from './EditToolRow'
import { FileToolRow } from './FileToolRow'
import { GenericToolRow } from './GenericToolRow'

import { ShellToolRow } from './ShellToolRow'

const SHELL_TOOLS = new Set(['bash', 'sh', 'computer_bash', 'run_command'])
const EDIT_TOOLS = new Set(['edit', 'multiedit', 'write', 'patch', 'apply_patch'])
const FILE_TOOLS = new Set(['read'])

const ASK_TOOLS = new Set(['ask_user_question'])

export interface ToolCardViewProps {
  card: ToolCard
  onFileClick?: (relativePath: string) => void
  displayPreferences: DisplayPreferences
  shimmerActive: boolean
}

export const ToolCardView: Component<ToolCardViewProps> = (props) => {
  const shimmerClass = () => `tool-shimmer-scope${props.shimmerActive ? ' is-tool-shimmering' : ''}`

  if (SHELL_TOOLS.has(props.card.toolName))
    return (
      <div class={shimmerClass()}>
        <ShellToolRow card={props.card} displayPreferences={props.displayPreferences} />
      </div>
    )
  if (EDIT_TOOLS.has(props.card.toolName)) {
    return (
      <div class={shimmerClass()}>
        <EditToolRow
          card={props.card}
          onFileClick={props.onFileClick}
          displayPreferences={props.displayPreferences}
        />
      </div>
    )
  }
  if (FILE_TOOLS.has(props.card.toolName)) {
    return (
      <div class={shimmerClass()}>
        <FileToolRow card={props.card} onFileClick={props.onFileClick} />
      </div>
    )
  }
  if (ASK_TOOLS.has(props.card.toolName)) {
    return (
      <div class={shimmerClass()}>
        <AskToolRow card={props.card} />
      </div>
    )
  }
  return (
    <div class={shimmerClass()}>
      <GenericToolRow card={props.card} />
    </div>
  )
}
