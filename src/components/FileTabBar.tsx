/**
 * FileTabBar — horizontal scrollable tab strip for open files in the preview pane.
 *
 * Each tab: [FileIcon] [filename] [×]
 * Active tab gets a bottom accent. The × removes just that tab (not the active one).
 * Authority: purely presentational; parent (App) owns the open-files state.
 */

// biome-ignore-all lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: tab role is interactive; keyboard handled on the button close element

import { X } from 'lucide-solid'
import { For } from 'solid-js'
import { FileIcon } from '../lib/fileIcons'

interface FileTabBarProps {
  files: string[]
  activeIndex: number
  onSelect: (idx: number) => void
  onClose: (idx: number) => void
}

function tabFileName(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() ?? path
}

export function FileTabBar(props: FileTabBarProps) {
  return (
    <div class="ftb-bar" role="tablist" aria-label="Open files">
      <For each={props.files}>
        {(file, i) => (
          <div
            role="tab"
            tabIndex={0}
            aria-selected={i() === props.activeIndex}
            class={`ftb-tab${i() === props.activeIndex ? ' is-active' : ''}`}
            onClick={() => props.onSelect(i())}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                props.onSelect(i())
              }
            }}
            title={file}
          >
            <FileIcon name={tabFileName(file)} size={13} />
            <span class="ftb-tab-name">{tabFileName(file)}</span>
            <button
              type="button"
              class="ftb-tab-close"
              onClick={(e) => {
                e.stopPropagation()
                props.onClose(i())
              }}
              title={`Close ${tabFileName(file)}`}
              aria-label={`Close ${tabFileName(file)}`}
            >
              <X size={11} strokeWidth={2.2} />
            </button>
          </div>
        )}
      </For>
    </div>
  )
}
