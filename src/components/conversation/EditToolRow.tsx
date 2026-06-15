// biome-ignore-all lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: pre-existing tool-card file chip
import { type Component, createEffect, createSignal, For, onCleanup, Show } from 'solid-js'
import type { DisplayPreferences } from '../../lib/displayPreferences'
import { FileIcon } from '../../lib/fileIcons'
import { labelForTool } from '../../lib/sessionView'
import type { ToolCard } from '../../types/session'
import { extractEditPairs, extractFilePath, extractWriteLines } from './toolCardHelpers'

type EditToolRowProps = {
  card: ToolCard
  onFileClick?: (relativePath: string) => void
  displayPreferences: DisplayPreferences
}

export const EditToolRow: Component<EditToolRowProps> = (props) => {
  const [open, setOpen] = createSignal(props.displayPreferences.expandEditToolParts)
  const [manualToggle, setManualToggle] = createSignal(false)

  // Auto-switch between split (wide) and unified (narrow) diff view
  const [diffWidth, setDiffWidth] = createSignal(0)
  let diffContainerEl: HTMLDivElement | undefined
  createEffect(() => {
    const el = diffContainerEl
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setDiffWidth(e.contentRect.width)
    })
    ro.observe(el)
    onCleanup(() => ro.disconnect())
  })
  const diffMode = () => (diffWidth() >= 500 ? 'split' : 'unified')

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
    isWrite()
      ? writeLines().length > 0
      : pairs().some((pair) => pair.old || pair.new) || !!props.card.output

  return (
    <div class={`tool-row${props.card.isError ? ' is-error' : ''}`}>
      <button
        type="button"
        class="tool-ran-header"
        onClick={() => {
          setManualToggle(true)
          setOpen((v) => !v)
        }}
        style={{ cursor: 'pointer' }}
      >
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
        <Show when={!props.card.streaming}>
          <span class="tool-chevron" data-open={open()} aria-hidden="true">
            {open() ? '⌄' : '›'}
          </span>
        </Show>
      </button>

      <Show when={open()}>
        <div class="tool-output-connector">
          <Show when={!hasContent()}>
            <pre class="edit-output">{props.card.output}</pre>
          </Show>
          <Show when={hasContent()}>
            <div class="tool-diff-view" ref={diffContainerEl}>
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

              <Show when={!isWrite() && diffMode() === 'unified'}>
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

              <Show when={!isWrite() && diffMode() === 'split'}>
                <For each={pairs()}>
                  {(pair, pairIndex) => (
                    <div class="diff-pair">
                      <div class="diff-split-body">
                        <div class="diff-split-side diff-split-old">
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
                        </div>

                        <div class="diff-split-side diff-split-new">
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
                        </div>
                      </div>
                      <Show when={pairIndex() < pairs().length - 1}>
                        <div class="diff-pair-sep" />
                      </Show>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  )
}
