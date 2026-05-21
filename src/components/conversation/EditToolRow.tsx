// biome-ignore-all lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: pre-existing tool-card file chip
import { type Component, createEffect, createSignal, For, Show } from 'solid-js'
import type { DisplayPreferences } from '../../lib/displayPreferences'
import { FileIcon } from '../../lib/fileIcons'
import { labelForTool } from '../../lib/sessionView'
import type { ToolCard } from '../../types/session'
import { ToolTypeIcon } from './ToolIcon'
import { extractEditPairs, extractFilePath, extractWriteLines } from './toolCardHelpers'

type EditToolRowProps = {
  card: ToolCard
  onFileClick?: (relativePath: string) => void
  displayPreferences: DisplayPreferences
}

export const EditToolRow: Component<EditToolRowProps> = (props) => {
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
