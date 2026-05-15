// biome-ignore-all lint/a11y/useAriaPropsSupportedByRole lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: existing tool-card file chip interactions are tracked separately from this release.
import {
  Eye,
  FileEdit,
  FilePen,
  Files,
  FolderSearch,
  List,
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
  return typeof card.args.command === 'string'
    ? card.args.command
    : typeof card.args.path === 'string'
      ? card.args.path
      : card.toolName
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
  return <GenericToolRow card={props.card} />
}
