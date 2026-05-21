import { Bot } from 'lucide-solid'
import type { Component } from 'solid-js'
import { createEffect, For, Show } from 'solid-js'
import { FileIcon } from '../../lib/fileIcons'
import type { FffFileResult } from '../../lib/ipc'

interface MentionPickerProps {
  query: string
  fileResults: FffFileResult[]
  agentResults: { name: string; description: string }[]
  activeIdx: number
  attachedPaths: Set<string>
  onSelectFile: (file: FffFileResult) => void
  onSelectAgent: (name: string) => void
  onSetActiveIdx: (idx: number) => void
}

function countItems(props: MentionPickerProps): number {
  return props.agentResults.length + props.fileResults.length
}

export const MentionPicker: Component<MentionPickerProps> = (props) => {
  let listRef: HTMLDivElement | undefined

  createEffect(() => {
    const idx = props.activeIdx
    listRef?.querySelector(`[data-idx="${idx}"]`)?.scrollIntoView({ block: 'nearest' })
  })

  return (
    <div class="file-mention-picker" role="listbox" aria-label="Suggestions">
      <div class="file-mention-header">
        <span class="file-mention-kicker">Suggestions</span>
        <span class="file-mention-query">@{props.query}</span>
      </div>
      <div
        ref={(el) => {
          listRef = el
        }}
        class="file-mention-list"
      >
        <Show
          when={countItems(props) > 0}
          fallback={<div class="file-mention-empty">No matches</div>}
        >
          <Show when={props.agentResults.length > 0}>
            <div class="mention-section-header">Subagents</div>
            <For each={props.agentResults}>
              {(agent, idx) => {
                const globalIdx = idx()
                const isActive = () => globalIdx === props.activeIdx

                return (
                  <button
                    type="button"
                    data-idx={globalIdx}
                    class={`file-mention-item${isActive() ? ' is-active' : ''}`}
                    role="option"
                    aria-selected={isActive()}
                    onClick={() => props.onSelectAgent(agent.name)}
                    onMouseEnter={() => props.onSetActiveIdx(globalIdx)}
                  >
                    <span class="file-mention-icon mention-icon-agent">
                      <Bot size={12} strokeWidth={2.5} />
                    </span>
                    <span class="file-mention-main">
                      <span class="file-mention-name">
                        {agent.name.charAt(0).toUpperCase() + agent.name.slice(1)}
                      </span>
                      <span class="file-mention-dir">{agent.description}</span>
                    </span>
                  </button>
                )
              }}
            </For>
          </Show>
          <Show when={props.fileResults.length > 0}>
            <div class="mention-section-header">Files</div>
            <For each={props.fileResults}>
              {(f, idx) => {
                const globalIdx = props.agentResults.length + idx()
                const already = () => props.attachedPaths.has(f.relativePath)
                const isActive = () => globalIdx === props.activeIdx

                return (
                  <button
                    type="button"
                    data-idx={globalIdx}
                    class={`file-mention-item${isActive() ? ' is-active' : ''}${already() ? ' is-attached' : ''}`}
                    role="option"
                    aria-selected={isActive()}
                    disabled={already()}
                    onClick={() => {
                      if (!already()) props.onSelectFile(f)
                    }}
                    onMouseEnter={() => props.onSetActiveIdx(globalIdx)}
                  >
                    <span class="file-mention-icon">
                      <FileIcon name={f.fileName} size={13} />
                    </span>
                    <span class="file-mention-main">
                      <span class="file-mention-name">{f.fileName}</span>
                      <Show when={f.dir}>
                        <span class="file-mention-dir">{f.dir}</span>
                      </Show>
                    </span>
                    <Show when={already()}>
                      <span class="file-mention-badge">added</span>
                    </Show>
                  </button>
                )
              }}
            </For>
          </Show>
        </Show>
      </div>
      <div class="file-mention-footer">
        <span>↑↓ navigate</span>
        <span>↵ select</span>
        <span>esc close</span>
      </div>
    </div>
  )
}
