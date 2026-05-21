// biome-ignore-all lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: pre-existing tool-card file chip
import { type Component, createSignal, Show } from 'solid-js'
import { FileIcon } from '../../lib/fileIcons'
import { labelForTool } from '../../lib/sessionView'
import type { ToolCard } from '../../types/session'
import { ToolTypeIcon } from './ToolIcon'
import { extractFilePath, isImagePath, localFileUrl } from './toolCardHelpers'

type FileToolRowProps = {
  card: ToolCard
  onFileClick?: (relativePath: string) => void
}

export const FileToolRow: Component<FileToolRowProps> = (props) => {
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
