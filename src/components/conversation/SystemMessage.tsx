import { ChevronDown, FileCode, FilePen } from 'lucide-solid'
import { type Component, createSignal, For, Show } from 'solid-js'
import type { SystemMessage } from '../../types/session'

interface SystemMsgProps {
  message: SystemMessage
}

function shortPath(p: string, segments = 3): string {
  const parts = p.replace(/\\/g, '/').split('/')
  return parts.length <= segments ? p : `…/${parts.slice(-segments).join('/')}`
}

export const SystemMsg: Component<SystemMsgProps> = (props) => {
  const [expanded, setExpanded] = createSignal(false)

  const isCompaction = () => props.message.kind === 'compaction'
  const modifiedFiles = () => props.message.modifiedFiles ?? []
  const readFiles = () => props.message.readFiles ?? []
  const hasFiles = () => modifiedFiles().length > 0 || readFiles().length > 0
  const fileCount = () => modifiedFiles().length + readFiles().length

  return (
    <div
      class={`system-message${
        isCompaction() && props.message.done && hasFiles() ? ' system-message--expandable' : ''
      } ${props.message.done ? 'is-done' : 'is-pending'}`}
    >
      <div class="system-msg-row">
        <span class="system-msg-icon">{isCompaction() ? '⟳' : '↺'}</span>
        <span class="system-msg-text">{props.message.text}</span>

        <Show when={isCompaction() && props.message.done && hasFiles()}>
          <button
            type="button"
            class={`system-msg-toggle${expanded() ? ' is-open' : ''}`}
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded()}
            title={expanded() ? 'Hide files' : 'Show files & changes'}
          >
            <span class="system-msg-file-count">
              {fileCount()} {fileCount() === 1 ? 'file' : 'files'}
            </span>
            <ChevronDown size={11} strokeWidth={2} />
          </button>
        </Show>
      </div>

      <Show when={expanded() && hasFiles()}>
        <div class="system-msg-files">
          <Show when={modifiedFiles().length > 0}>
            <div class="system-msg-file-group">
              <span class="system-msg-file-label">
                <FilePen size={11} strokeWidth={2} />
                Modified
              </span>
              <div class="system-msg-file-list">
                <For each={modifiedFiles()}>
                  {(f) => (
                    <span class="system-msg-file-item system-msg-file-item--modified" title={f}>
                      {shortPath(f)}
                    </span>
                  )}
                </For>
              </div>
            </div>
          </Show>

          <Show when={readFiles().length > 0}>
            <div class="system-msg-file-group">
              <span class="system-msg-file-label">
                <FileCode size={11} strokeWidth={2} />
                Read
              </span>
              <div class="system-msg-file-list">
                <For each={readFiles()}>
                  {(f) => (
                    <span class="system-msg-file-item system-msg-file-item--read" title={f}>
                      {shortPath(f)}
                    </span>
                  )}
                </For>
              </div>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  )
}
