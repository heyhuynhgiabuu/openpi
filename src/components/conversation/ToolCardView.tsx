// biome-ignore-all lint/a11y/useAriaPropsSupportedByRole lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: existing tool-card file chip interactions are tracked separately from this release.
import { type Component, createEffect, createSignal, For, Show } from 'solid-js'
import type { DisplayPreferences } from '../../lib/displayPreferences'
import { FileIcon } from '../../lib/fileIcons'

import { labelForTool } from '../../lib/sessionView'
import type { ToolCard } from '../../types/session'
import { ToolIcon } from './ToolIcon'

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
const MAX_CMD = 72

type ToolTypeIconProps = {
  toolName: string
  streaming?: boolean
  isError?: boolean
}

function ToolTypeIcon(props: ToolTypeIconProps) {
  const state = () => (props.streaming ? 'pending' : props.isError ? 'error' : 'done')
  const isShell = () => SHELL_TOOLS.has(props.toolName)
  const title = () => (props.streaming ? 'running…' : props.isError ? 'failed' : 'done')

  return (
    <span
      class={`tool-type-icon tool-icon-${state()} ${isShell() ? 'is-shell' : ''}`}
      title={title()}
      aria-label={title()}
    >
      <ToolIcon name={props.toolName} />
    </span>
  )
}

function extractFilePath(card: ToolCard): string | null {
  const p = card.args.path ?? card.args.file_path
  return typeof p === 'string' ? p : null
}

function extractCommand(card: ToolCard): string {
  if (typeof card.args.command === 'string') return card.args.command
  if (typeof card.args.path === 'string') return card.args.path
  // Agent tool: show the description
  if (card.toolName === 'Agent' && typeof card.args.description === 'string')
    return card.args.description
  // TaskCreate: show the subject
  if (card.toolName === 'TaskCreate' && typeof card.args.subject === 'string')
    return card.args.subject
  // TaskGet/TaskUpdate/TaskStop: show the task id
  if (
    ['TaskGet', 'TaskUpdate', 'TaskStop'].includes(card.toolName) &&
    typeof card.args.taskId === 'string'
  )
    return `#${card.args.taskId}`
  // TaskExecute: show the task ids
  if (card.toolName === 'TaskExecute' && Array.isArray(card.args.task_ids))
    return `[${card.args.task_ids.join(', ')}]`
  // TaskList: show count
  if (card.toolName === 'TaskList') return 'all tasks'
  // TaskOutput: show task id
  if (card.toolName === 'TaskOutput' && typeof card.args.task_id === 'string')
    return `#${card.args.task_id}`
  // ask_user_question: show the question text
  if (card.toolName === 'ask_user_question') {
    const qs = card.args.questions
    if (Array.isArray(qs) && qs.length > 0) {
      const first = qs[0] as Record<string, unknown>
      const q = typeof first.question === 'string' ? first.question : ''
      const header = typeof first.header === 'string' ? first.header : ''
      return `✻ ${header || q.slice(0, 60)}`
    }
    return 'question'
  }
  // get_subagent_result: show agent id
  if (card.toolName === 'get_subagent_result' && typeof card.args.agent_id === 'string')
    return `#${card.args.agent_id}`
  // steer_subagent: show agent id
  if (card.toolName === 'steer_subagent' && typeof card.args.agent_id === 'string')
    return `#${card.args.agent_id}`
  // Goal/plan tools: show tool name
  // Legacy spec tools: richer preview per type
  if (card.toolName.startsWith('spec_')) {
    const name = typeof card.args.name === 'string' ? card.args.name : ''
    switch (card.toolName) {
      case 'spec_create':
        return name
      case 'spec_next_phase':
        return name ? `${name} → next phase` : 'next phase'
      case 'spec_run_task':
        return `${name} · task ${(card.args.taskId as string) ?? ''}`
      case 'spec_run_all':
        return `${name} · run all tasks`
      case 'spec_status':
        return name ? `status: ${name}` : 'legacy specs'
      case 'spec_analyze':
        return `${name} · analyze`
      case 'spec_sync_tasks':
        return `${name} · sync tasks`
      default:
        return name || card.toolName
    }
  }
  return card.toolName
}

interface EditPair {
  old: string
  new: string
}

function extractEditPairs(card: ToolCard): EditPair[] {
  const editsArr = card.args.edits
  if (Array.isArray(editsArr) && editsArr.length > 0) {
    return editsArr.map((e: { oldText?: string; newText?: string }) => ({
      old: typeof e.oldText === 'string' ? e.oldText : '',
      new: typeof e.newText === 'string' ? e.newText : '',
    }))
  }
  const oldT = card.args.oldText
  const newT = card.args.newText
  if (typeof oldT === 'string' || typeof newT === 'string') {
    return [
      { old: typeof oldT === 'string' ? oldT : '', new: typeof newT === 'string' ? newT : '' },
    ]
  }
  return []
}

function extractWriteLines(card: ToolCard): string[] {
  const content = card.args.content
  if (typeof content === 'string') return content.split('\n')
  return []
}

type EditToolRowProps = {
  card: ToolCard
  onFileClick?: (p: string) => void
  displayPreferences: DisplayPreferences
}

const EditToolRow: Component<EditToolRowProps> = (props) => {
  const [open, setOpen] = createSignal(props.displayPreferences.expandEditToolParts)
  const [manualToggle, setManualToggle] = createSignal(false)

  // Sync preference → open state, but only while the user hasn't manually toggled this card
  createEffect(() => {
    if (!manualToggle()) setOpen(props.displayPreferences.expandEditToolParts)
  })

  const filePath = () => extractFilePath(props.card) ?? props.card.toolName
  const basename = () => filePath().split('/').pop() ?? filePath()
  const isWrite = () => props.card.toolName === 'write'
  const pairs = () => (isWrite() ? [] : extractEditPairs(props.card))
  const writeLines = () => (isWrite() ? extractWriteLines(props.card) : [])

  const totalAdded = () => {
    if (isWrite()) return writeLines().length
    return pairs().reduce((sum, pair) => sum + (pair.new ? pair.new.split('\n').length : 0), 0)
  }

  const totalRemoved = () => {
    if (isWrite()) return 0
    return pairs().reduce((sum, pair) => sum + (pair.old ? pair.old.split('\n').length : 0), 0)
  }

  const hasContent = () =>
    isWrite() ? writeLines().length > 0 : pairs().some((pair) => pair.old || pair.new)

  return (
    <div class="tool-row">
      <button
        type="button"
        class="tool-ran-header"
        onClick={() => {
          if (hasContent()) {
            setManualToggle(true)
            setOpen((v) => !v)
          }
        }}
        style={{ cursor: hasContent() ? 'pointer' : 'default' }}
      >
        <ToolTypeIcon
          toolName={props.card.toolName}
          streaming={props.card.streaming}
          isError={props.card.isError}
        />
        <span class="tool-ran-label">{labelForTool(props.card.toolName)}</span>
        <span class="tool-file-chip">
          <FileIcon name={basename()} size={13} />
          <span
            class="tool-file-path"
            onClick={(e) => {
              e.stopPropagation()
              props.onFileClick?.(filePath())
            }}
            title={filePath()}
          >
            {filePath()}
          </span>
        </span>
        <Show when={!props.card.streaming && hasContent()}>
          <span class="tool-diff-stats">
            <Show when={totalAdded() > 0}>
              <span class="diff-stat-add">+{totalAdded()}</span>
            </Show>
            <Show when={totalRemoved() > 0}>
              <span class="diff-stat-rem">-{totalRemoved()}</span>
            </Show>
          </span>
        </Show>
        <Show when={props.card.streaming}>
          <span class="tool-streaming-dot">·</span>
        </Show>
        <Show when={hasContent() && !props.card.streaming}>
          <span class="tool-chevron" aria-hidden="true">
            {open() ? '⌄' : '›'}
          </span>
        </Show>
      </button>

      <Show when={open() && hasContent()}>
        <div class="tool-output-connector">
          <div class="tool-diff-view">
            <Show when={isWrite()}>
              <For each={writeLines()}>
                {(line) => (
                  <div class="diff-line diff-added">
                    <span class="diff-prefix" aria-hidden="true">
                      +
                    </span>
                    <span class="diff-text">{line}</span>
                  </div>
                )}
              </For>
            </Show>

            <Show when={!isWrite()}>
              <For each={pairs()}>
                {(pair, pairIndex) => (
                  <div class="diff-pair">
                    <For each={pair.old.split('\n')}>
                      {(line) => (
                        <div class="diff-line diff-removed">
                          <span class="diff-prefix" aria-hidden="true">
                            -
                          </span>
                          <span class="diff-text">{line}</span>
                        </div>
                      )}
                    </For>
                    <For each={pair.new.split('\n')}>
                      {(line) => (
                        <div class="diff-line diff-added">
                          <span class="diff-prefix" aria-hidden="true">
                            +
                          </span>
                          <span class="diff-text">{line}</span>
                        </div>
                      )}
                    </For>
                    <Show when={pairIndex() < pairs().length - 1}>
                      <div class="diff-pair-sep" />
                    </Show>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  )
}

type ShellToolRowProps = {
  card: ToolCard
  displayPreferences: DisplayPreferences
}

const ShellToolRow: Component<ShellToolRowProps> = (props) => {
  const [open, setOpen] = createSignal(props.displayPreferences.expandShellToolParts)
  const [manualToggle, setManualToggle] = createSignal(false)

  // Sync preference → open state, but only while the user hasn't manually toggled this card
  createEffect(() => {
    if (!manualToggle()) setOpen(props.displayPreferences.expandShellToolParts)
  })

  const cmd = () => extractCommand(props.card)
  const isTruncated = () => cmd().length > MAX_CMD
  const displayCmd = () => (isTruncated() ? `${cmd().slice(0, MAX_CMD)}…` : cmd())
  const hasOutput = () => !!props.card.output?.trim()

  return (
    <div class="tool-row">
      <button
        type="button"
        class="tool-ran-header"
        onClick={() => {
          if (hasOutput()) {
            setManualToggle(true)
            setOpen((v) => !v)
          }
        }}
        title={isTruncated() ? cmd() : undefined}
        style={{ cursor: hasOutput() ? 'pointer' : 'default' }}
      >
        <ToolTypeIcon
          toolName={props.card.toolName}
          streaming={props.card.streaming}
          isError={props.card.isError}
        />
        <span class="tool-ran-label">Ran</span>
        <code class="tool-ran-cmd">{displayCmd()}</code>
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

function localFileUrl(absPath: string): string {
  return `localfile://${absPath
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/')}`
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'svg', 'avif'])
function isImagePath(p: string): boolean {
  return IMAGE_EXTS.has(p.split('.').pop()?.toLowerCase() ?? '')
}

type FileToolRowProps = {
  card: ToolCard
  onFileClick?: (p: string) => void
}

const FileToolRow: Component<FileToolRowProps> = (props) => {
  const [open, setOpen] = createSignal(false)
  const filePath = () => extractFilePath(props.card) ?? props.card.toolName
  const basename = () => filePath().split('/').pop() ?? filePath()
  const isImage = () => isImagePath(filePath())
  const hasText = () => !isImage() && !!props.card.output?.trim()
  const hasExpandable = () => isImage() || hasText()

  return (
    <div class="tool-row">
      <button
        type="button"
        class="tool-ran-header"
        onClick={() => hasExpandable() && setOpen((v) => !v)}
        style={{ cursor: hasExpandable() ? 'pointer' : 'default' }}
      >
        <ToolTypeIcon
          toolName={props.card.toolName}
          streaming={props.card.streaming}
          isError={props.card.isError}
        />
        <span class="tool-ran-label">{labelForTool(props.card.toolName)}</span>
        <span class="tool-file-chip">
          <FileIcon name={basename()} size={13} />
          <span
            class="tool-file-path"
            onClick={(e) => {
              e.stopPropagation()
              props.onFileClick?.(filePath())
            }}
            title={filePath()}
          >
            {filePath()}
          </span>
        </span>
        <Show when={props.card.streaming}>
          <span class="tool-streaming-dot">·</span>
        </Show>
        <Show when={hasExpandable() && !props.card.streaming}>
          <span class="tool-chevron" aria-hidden="true">
            {open() ? '⌄' : '›'}
          </span>
        </Show>
      </button>

      <Show when={open() && isImage() && !props.card.streaming}>
        <div class="tool-output-connector">
          <div class="tool-image-preview">
            <img
              src={localFileUrl(filePath())}
              alt={basename()}
              class="tool-image-img"
              onError={(e) => {
                const previewEl = e.currentTarget.closest(
                  '.tool-image-preview'
                ) as HTMLElement | null
                if (previewEl) previewEl.style.display = 'none'
              }}
            />
          </div>
        </div>
      </Show>

      <Show when={open() && hasText()}>
        <div class="tool-output-connector">
          <div class={`tool-ran-output ${props.card.isError ? 'is-error' : ''}`}>
            <pre>{props.card.output}</pre>
          </div>
        </div>
      </Show>
    </div>
  )
}

type GenericToolRowProps = {
  card: ToolCard
}

const GenericToolRow: Component<GenericToolRowProps> = (props) => {
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

// ── Plan tool row ───────────────────────────────────────────────────────

type PlanItemStatus = 'pending' | 'in_progress' | 'completed'

interface PlanItem {
  step: string
  status: PlanItemStatus
}

function isPlanItemStatus(value: unknown): value is PlanItemStatus {
  return value === 'pending' || value === 'in_progress' || value === 'completed'
}

function parsePlanItems(args: Record<string, unknown>): PlanItem[] {
  const raw = args.plan
  if (!Array.isArray(raw)) return []

  return raw
    .map((item): PlanItem | null => {
      if (!item || typeof item !== 'object') return null
      const record = item as Record<string, unknown>
      const step = typeof record.step === 'string' ? record.step.trim() : ''
      const status = record.status
      if (!step || !isPlanItemStatus(status)) return null
      return { step, status }
    })
    .filter((item): item is PlanItem => item !== null)
}

function planStatusLabel(status: PlanItemStatus): string {
  switch (status) {
    case 'completed':
      return 'done'
    case 'in_progress':
      return 'now'
    case 'pending':
      return 'next'
  }
}

type PlanToolRowProps = {
  card: ToolCard
}

const PlanToolRow: Component<PlanToolRowProps> = (props) => {
  const items = () => parsePlanItems(props.card.args)
  const explanation = () => {
    const value = props.card.args.explanation
    return typeof value === 'string' ? value.trim() : ''
  }
  const completed = () => items().filter((item) => item.status === 'completed').length
  const inProgress = () => items().find((item) => item.status === 'in_progress')

  return (
    <div class="tool-row">
      <div class="tool-ran-header plan-tool-header">
        <ToolTypeIcon
          toolName={props.card.toolName}
          streaming={props.card.streaming}
          isError={props.card.isError}
        />
        <span class="tool-ran-label">Plan updated</span>
        <Show
          when={inProgress()}
          fallback={
            <span class="plan-tool-summary">
              {completed()} / {items().length} done
            </span>
          }
        >
          {(item) => <span class="plan-tool-summary">Now: {item().step}</span>}
        </Show>
        <Show when={props.card.streaming}>
          <span class="tool-streaming-dot">·</span>
        </Show>
      </div>

      <Show when={explanation()}>
        <div class="plan-tool-explanation">{explanation()}</div>
      </Show>

      <Show when={items().length > 0}>
        <ol class="plan-tool-list">
          <For each={items()}>
            {(item) => (
              <li class={`plan-tool-item plan-tool-item--${item.status}`}>
                <span class="plan-tool-marker" aria-hidden="true">
                  {item.status === 'completed' ? '✓' : item.status === 'in_progress' ? '•' : '○'}
                </span>
                <span class="plan-tool-step">{item.step}</span>
                <span class="plan-tool-status">{planStatusLabel(item.status)}</span>
              </li>
            )}
          </For>
        </ol>
      </Show>
    </div>
  )
}

// ── Harness / legacy spec tool row ──────────────────────────────────────

function harnessActionForTool(name: string): string {
  switch (name) {
    case 'get_goal':
      return 'get_goal'
    case 'create_goal':
      return 'create_goal'
    case 'update_goal':
      return 'update_goal'
    case 'update_plan':
      return 'update_plan'
    case 'spec_create':
      return 'legacy-create'
    case 'spec_next_phase':
      return 'legacy-phase'
    case 'spec_run_task':
      return 'legacy-task'
    case 'spec_run_all':
      return 'legacy-run-all'
    case 'spec_status':
      return 'legacy-status'
    case 'spec_analyze':
      return 'legacy-analyze'
    case 'spec_sync_tasks':
      return 'legacy-sync'
    default:
      return 'harness'
  }
}

function parseGoalOutputSummary(_toolName: string, output: string): string | null {
  if (!output) return null
  const first = output.split('\n').find((l) => l.trim()) ?? ''
  return first.length > 60 ? `${first.slice(0, 57)}...` : first
}

function parseHarnessTaskId(card: ToolCard): string | null {
  const id = card.args.taskId
  return typeof id === 'string' ? id : null
}

type HarnessToolRowProps = {
  card: ToolCard
}

const HarnessToolRow: Component<HarnessToolRowProps> = (props) => {
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

function parseAskQuestions(args: Record<string, unknown>): AskQuestion[] {
  const raw = args.questions
  if (!Array.isArray(raw)) return []
  return raw
    .map((q) => {
      const r = q as Record<string, unknown>
      const question = String(r.question ?? '')
      const header = String(r.header ?? '')
      const multiSelect = Boolean(r.multiSelect)
      const options = Array.isArray(r.options)
        ? r.options.map((o: unknown) => {
            const opt = o as Record<string, unknown>
            return {
              label: String(opt.label ?? ''),
              description: opt.description ? String(opt.description) : undefined,
            }
          })
        : []
      return { question, header, options, multiSelect }
    })
    .filter((q) => q.question && q.options.length >= 1)
}

type AskToolRowProps = {
  card: ToolCard
}

const AskToolRow: Component<AskToolRowProps> = (props) => {
  const questions = () => parseAskQuestions(props.card.args)
  const questionCount = () => questions().length
  const isMulti = () => questions().some((q) => q.multiSelect)

  return (
    <div class="tool-row">
      <div class="tool-ran-header ask-tool-compact-header">
        <ToolTypeIcon
          toolName={props.card.toolName}
          streaming={props.card.streaming}
          isError={props.card.isError}
        />
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
