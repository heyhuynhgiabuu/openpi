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
}

export const ToolCardView: Component<ToolCardViewProps> = (props) => {
  if (SHELL_TOOLS.has(props.card.toolName))
    return <ShellToolRow card={props.card} displayPreferences={props.displayPreferences} />
  if (EDIT_TOOLS.has(props.card.toolName)) {
    return (
      <EditToolRow
        card={props.card}
        onFileClick={props.onFileClick}
        displayPreferences={props.displayPreferences}
      />
    )
  }
  if (FILE_TOOLS.has(props.card.toolName)) {
    return <FileToolRow card={props.card} onFileClick={props.onFileClick} />
  }
  if (ASK_TOOLS.has(props.card.toolName)) {
    return <AskToolRow card={props.card} />
  }
  return <GenericToolRow card={props.card} />
}
