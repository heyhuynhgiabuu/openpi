import type { FileLineComment } from '../../lib/fileLineComments'
import type { ModelInfo, SessionStats, SkillItem } from '../../lib/ipc'
import type { GoalProgress, GoalStep } from '../GoalBanner'

export type QueueMode = 'prompt' | 'steer' | 'followup'

export interface SlashCommand {
  name: string
  description: string
  argHint?: string
}

export interface ComposerProps {
  input: string
  isStreaming: boolean
  isShellRunning: boolean
  queueMode: QueueMode
  workspaceName: string
  /** Most-recent-first list of user message texts for Up/Down history navigation */
  promptHistory: string[]
  steeringQueue: string[]
  followUpQueue: string[]
  setTextareaRef: (el: HTMLTextAreaElement) => void
  /** Workspace root path — used to fetch the file list for the context picker */
  cwd: string | null
  /** Relative paths of files currently attached as context */
  attachedFiles: string[]
  onAddFile: (relPath: string) => void
  onRemoveFile: (relPath: string) => void
  /** File line comments captured from the file preview modal */
  lineComments: FileLineComment[]
  onRemoveLineComment: (id: string) => void
  /** Loaded skill items (prepended as context on send) */
  loadedSkills: SkillItem[]
  onAddSkill: (skill: SkillItem) => void
  onRemoveSkill: (name: string) => void
  // Model
  models: ModelInfo[]
  currentModel: ModelInfo | null
  onSelectModel: (model: ModelInfo) => void
  // Thinking
  thinkingLevel: string
  onThinkingLevel: (level: string) => void
  // Provider actions
  onConnectProvider: () => void
  onManageModels: () => void
  onInput: (value: string) => void
  onQueueMode: (mode: QueueMode | ((mode: QueueMode) => QueueMode)) => void
  onSend: () => void
  onShellSend: () => void
  onAbort: () => void
  // Goal state
  activeGoalText: string | null
  activeGoalStep: GoalStep
  activeGoalElapsed: number | null
  activeGoalProgress: GoalProgress | null
  onSetActiveGoal: (text: string | null) => void
  /** 0-100 percentage of context window consumed. Null when unknown. */
  contextPercent?: number | null
  /** Full session stats for the context popover. */
  sessionStats?: SessionStats | null
  /** Last completed agent run tokens-per-second, Pi-compatible wall-clock TPS. */
  agentTps?: number | null
  /** Available subagent types for @mention autocomplete. */
  availableAgentTypes?: { name: string; description: string }[]
}
