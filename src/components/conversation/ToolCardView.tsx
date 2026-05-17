// biome-ignore-all lint/a11y/useAriaPropsSupportedByRole lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: existing tool-card file chip interactions are tracked separately from this release.
import {
  ArrowRight,
  Bot,
  Eye,
  FileEdit,
  FilePen,
  Files,
  FileText,
  FolderSearch,
  Info,
  List,
  ListChecks,
  Play,
  RefreshCw,
  Search,
  Terminal,
  Wrench,
} from 'lucide-solid'
import { type Component, createEffect, createSignal, For, Show } from 'solid-js'
import type { DisplayPreferences } from '../../lib/displayPreferences'
import { FileIcon } from '../../lib/fileIcons'
import { labelForTool } from '../../lib/sessionView'
import type { ToolCard } from '../../types/session'

const SHELL_TOOLS = new Set(['bash', 'sh', 'computer_bash', 'run_command'])
const EDIT_TOOLS = new Set(['edit', 'multiedit', 'write', 'patch', 'apply_patch'])
const FILE_TOOLS = new Set(['read'])
const HARNESS_TOOLS = new Set([
  'harness_status',
  'harness_intake',
  'harness_init',
  'harness_lint',
  'story_create',
  'decision_record',
  'test_matrix_update',
])
const SPEC_TOOLS = new Set([
  'spec_create',
  'spec_next_phase',
  'spec_run_task',
  'spec_run_all',
  'spec_status',
  'spec_analyze',
  'spec_sync_tasks',
])
const MAX_CMD = 72

const ICON_PROPS = { size: 13, strokeWidth: 2 } as const

type ToolIconProps = {
  name: string
}

function ToolIcon(props: ToolIconProps) {
  switch (props.name) {
    case 'bash':
    case 'sh':
    case 'computer_bash':
    case 'run_command':
      return <Terminal {...ICON_PROPS} />
    case 'read':
      return <Eye {...ICON_PROPS} />
    case 'write':
      return <FileEdit {...ICON_PROPS} />
    case 'edit':
      return <FilePen {...ICON_PROPS} />
    case 'multiedit':
      return <Files {...ICON_PROPS} />
    case 'grep':
      return <Search {...ICON_PROPS} />
    case 'find':
      return <FolderSearch {...ICON_PROPS} />
    case 'ls':
      return <List {...ICON_PROPS} />
    case 'Agent':
    case 'get_subagent_result':
    case 'steer_subagent':
      return <Bot {...ICON_PROPS} />
    case 'TaskCreate':
    case 'TaskList':
    case 'TaskGet':
    case 'TaskUpdate':
    case 'TaskExecute':
    case 'TaskOutput':
    case 'TaskStop':
      return <ListChecks {...ICON_PROPS} />
    case 'harness_status':
      return <Info {...ICON_PROPS} />
    case 'harness_intake':
      return <Search {...ICON_PROPS} />
    case 'harness_init':
      return <FileText {...ICON_PROPS} />
    case 'harness_lint':
      return <ListChecks {...ICON_PROPS} />
    case 'story_create':
      return <FileText {...ICON_PROPS} />
    case 'decision_record':
      return <Info {...ICON_PROPS} />
    case 'test_matrix_update':
      return <RefreshCw {...ICON_PROPS} />
    case 'spec_create':
      return <FileText {...ICON_PROPS} />
    case 'spec_next_phase':
      return <ArrowRight {...ICON_PROPS} />
    case 'spec_run_task':
      return <Play {...ICON_PROPS} />
    case 'spec_run_all':
      return <ListChecks {...ICON_PROPS} />
    case 'spec_status':
      return <Info {...ICON_PROPS} />
    case 'spec_analyze':
      return <Search {...ICON_PROPS} />
    case 'spec_sync_tasks':
      return <RefreshCw {...ICON_PROPS} />
    default:
      return <Wrench {...ICON_PROPS} />
  }
}

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
  // get_subagent_result: show agent id
  if (card.toolName === 'get_subagent_result' && typeof card.args.agent_id === 'string')
    return `#${card.args.agent_id}`
  // steer_subagent: show agent id
  if (card.toolName === 'steer_subagent' && typeof card.args.agent_id === 'string')
    return `#${card.args.agent_id}`
  // Harness tools: richer preview per type
  if (HARNESS_TOOLS.has(card.toolName)) {
    const focus = typeof card.args.focus === 'string' ? card.args.focus : ''
    const intent = typeof card.args.intent === 'string' ? card.args.intent : ''
    const title = typeof card.args.title === 'string' ? card.args.title : ''
    const area = typeof card.args.area === 'string' ? card.args.area : ''
    const behavior = typeof card.args.behavior === 'string' ? card.args.behavior : ''
    switch (card.toolName) {
      case 'harness_status':
        return focus ? `status: ${focus}` : 'status'
      case 'harness_intake':
        return intent || 'intake'
      case 'harness_init':
        return card.args.overwrite === true ? 'init · overwrite' : 'init missing docs'
      case 'harness_lint':
        return 'lint'
      case 'story_create':
        return title || 'new story'
      case 'decision_record':
        return title || 'new decision'
      case 'test_matrix_update':
        return area && behavior ? `${area} · ${behavior}` : area || behavior || 'matrix update'
      default:
        return card.toolName
    }
  }
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

// ── Harness / legacy spec tool row ──────────────────────────────────────

function harnessActionForTool(name: string): string {
  switch (name) {
    case 'harness_status':
      return 'status'
    case 'harness_intake':
      return 'intake'
    case 'harness_init':
      return 'init'
    case 'harness_lint':
      return 'lint'
    case 'story_create':
      return 'story'
    case 'decision_record':
      return 'decision'
    case 'test_matrix_update':
      return 'test-matrix'
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

function parseHarnessTypeBadge(card: ToolCard): string | null {
  const t = card.args.type
  if (t === 'feature' || t === 'bugfix') return t
  return null
}

function parseHarnessWorkflowBadge(card: ToolCard): string | null {
  const w = card.args.workflow
  if (w === 'requirements-first' || w === 'design-first' || w === 'quick-plan') return w
  return null
}

function parseHarnessOutputSummary(toolName: string, output: string): string | null {
  if (!output) return null

  switch (toolName) {
    case 'harness_status': {
      const docMatch = output.match(/Required docs:\s*(\d+\/\d+)/i)
      const legacyMatch = output.match(/Legacy specs:\s*(\d+)/i)
      const parts: string[] = []
      if (docMatch) parts.push(`${docMatch[1]} docs`)
      if (legacyMatch) parts.push(`${legacyMatch[1]} legacy`)
      return parts.length ? parts.join(' · ') : null
    }
    case 'harness_intake': {
      const classMatch = output.match(/Classification:\s*([^\n]+)/i)
      const riskMatch = output.match(/Risk:\s*([^\n]+)/i)
      return [classMatch?.[1]?.trim(), riskMatch?.[1]?.trim()].filter(Boolean).join(' · ') || null
    }
    case 'harness_init': {
      const created = (output.match(/- created:/g) ?? []).length
      const kept = (output.match(/- kept:/g) ?? []).length
      const overwritten = (output.match(/- overwritten:/g) ?? []).length
      const parts: string[] = []
      if (created) parts.push(`${created} created`)
      if (kept) parts.push(`${kept} kept`)
      if (overwritten) parts.push(`${overwritten} overwritten`)
      return parts.length ? parts.join(' · ') : null
    }
    case 'harness_lint': {
      const issues = output.match(/Issues:\s*(\d+)/i)?.[1]
      const warnings = output.match(/Warnings:\s*(\d+)/i)?.[1]
      return issues || warnings ? `${issues ?? 0} issues · ${warnings ?? 0} warnings` : null
    }
    case 'story_create': {
      const criteria = output.match(/Acceptance criteria:\s*(\d+)/i)?.[1]
      if (/already exists/i.test(output)) return 'already exists'
      return criteria ? `${criteria} criteria` : null
    }
    case 'decision_record': {
      const status = output.match(/Status:\s*([^\n]+)/i)?.[1]
      if (/already exists/i.test(output)) return 'already exists'
      return status ? status.trim() : null
    }
    case 'test_matrix_update': {
      const status = output.match(/Status:\s*([^\n]+)/i)?.[1]
      return status ? status.trim() : 'row appended'
    }
    case 'spec_next_phase': {
      const phaseMatch = output.match(
        /(requirements|design|tasks)\s*(→|->|to)\s*(requirements|design|tasks)/i
      )
      if (phaseMatch) return `${phaseMatch[1]} → ${phaseMatch[3]}`
      if (/completed|generated/i.test(output)) return 'completed'
      return null
    }
    case 'spec_run_task': {
      if (/completed/i.test(output)) return 'done'
      if (/blocked/i.test(output)) return 'blocked'
      if (/failed/i.test(output)) return 'failed'
      return null
    }
    case 'spec_run_all': {
      const tasksMatch = output.match(/(\d+)\s*tasks?/i)
      const wavesMatch = output.match(/(\d+)\s*waves?/i)
      const parts: string[] = []
      if (tasksMatch) parts.push(`${tasksMatch[1]} tasks`)
      if (wavesMatch) parts.push(`wave ${wavesMatch[1]}`)
      if (!parts.length && /completed|finished/i.test(output)) return 'completed'
      return parts.length ? parts.join(', ') : null
    }
    case 'spec_status': {
      const lines = output
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
      const statusLine = lines.find(
        (l) => /phase/i.test(l) || (/\d+\/\d+/.test(l) && /task/i.test(l)) || /complete/i.test(l)
      )
      return statusLine || null
    }
    case 'spec_analyze': {
      const parts: string[] = []
      const ambigMatch = output.match(/(\d+)\s*ambiguities?/i)
      const gapMatch = output.match(/(\d+)\s*gaps?/i)
      const inconsistencyMatch = output.match(/(\d+)\s*inconsistenc/i)
      if (ambigMatch) parts.push(`${ambigMatch[1]} ambiguities`)
      if (gapMatch) parts.push(`${gapMatch[1]} gaps`)
      if (inconsistencyMatch) parts.push(`${inconsistencyMatch[1]} inconsistencies`)
      if (!parts.length && /no issues|looks good|clean/i.test(output)) return 'no issues found'
      return parts.length ? parts.join(' · ') : null
    }
    case 'spec_sync_tasks': {
      const match = output.match(/(\d+)\s*tasks?\s*(matched|complete|found|sync)/i)
      if (match) return `${match[1]} tasks matched`
      if (/no tasks?/i.test(output)) return 'no tasks to sync'
      return null
    }
    default:
      return null
  }
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
  const typeBadge = () => parseHarnessTypeBadge(props.card)
  const workflowBadge = () => parseHarnessWorkflowBadge(props.card)
  const taskId = () => parseHarnessTaskId(props.card)
  const outputSummary = () =>
    parseHarnessOutputSummary(props.card.toolName, props.card.output ?? '')
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
  return <GenericToolRow card={props.card} />
}
