// biome-ignore-all lint/a11y/useAriaPropsSupportedByRole lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: existing tool-card file chip interactions are tracked separately from this release.
import type { Component } from 'solid-js'
import type { DisplayPreferences } from '../../lib/displayPreferences'
import type { ToolCard } from '../../types/session'
import { AskToolRow } from './AskToolRow'
import { EditToolRow } from './EditToolRow'
import { FileToolRow } from './FileToolRow'
import { GenericToolRow } from './GenericToolRow'
import { HarnessToolRow } from './HarnessToolRow'
import { PlanToolRow } from './PlanToolRow'
import { ShellToolRow } from './ShellToolRow'

const SHELL_TOOLS = new Set(['bash', 'sh', 'computer_bash', 'run_command'])
const EDIT_TOOLS = new Set(['edit', 'multiedit', 'write', 'patch', 'apply_patch'])
const FILE_TOOLS = new Set(['read'])
const HARNESS_TOOLS = new Set<string>()
const SPEC_TOOLS = new Set([
  'spec_create',
  'spec_next_phase',
  'spec_run_task',
  'spec_run_all',
  'spec_status',
  'spec_analyze',
  'spec_sync_tasks',
])
const ASK_TOOLS = new Set(['ask_user_question'])
const PLAN_TOOLS = new Set(['update_plan'])

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
  if (HARNESS_TOOLS.has(props.card.toolName) || SPEC_TOOLS.has(props.card.toolName)) {
    return <HarnessToolRow card={props.card} />
  }
  if (ASK_TOOLS.has(props.card.toolName)) {
    return <AskToolRow card={props.card} />
  }
  if (PLAN_TOOLS.has(props.card.toolName)) {
    return <PlanToolRow card={props.card} />
  }
  return <GenericToolRow card={props.card} />
}
