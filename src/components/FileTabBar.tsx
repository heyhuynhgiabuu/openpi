/**
 * FileTabBar — horizontal scrollable tab strip for open files in the preview pane.
 *
 * Each tab: [FileIcon] [filename] [×]
 * Authority: purely presentational; parent owns the open-file and search state.
 */

// biome-ignore-all lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: tab role is interactive; keyboard handled on tabs and buttons

import { Plus, X } from 'lucide-solid'
import { For } from 'solid-js'
import { FileIcon } from '../lib/fileIcons'
import { diffPreviewPath, isDiffPreviewTab } from '../lib/previewTabs'

interface FileTabBarProps {
  files: string[]
  activeIndex: number
  onSelect: (idx: number) => void
  onClose: (idx: number) => void
  onRequestFileSearch: () => void
}

function tabPath(path: string): string {
  return diffPreviewPath(path).replace(/\\/g, '/')
}

function tabFileName(path: string): string {
  if (isDiffPreviewTab(path)) return 'Review'
  const normalized = tabPath(path)
  return normalized.split('/').pop() ?? normalized
}

function tabIconName(path: string): string {
  return tabPath(path).split('/').pop() ?? path
}

export function FileTabBar(props: FileTabBarProps) {
  return (
    <div class="ftb-bar" aria-label="Open files">
      <div class="ftb-tabs" role="tablist">
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
              title={isDiffPreviewTab(file) ? diffPreviewPath(file) : file}
            >
              <FileIcon name={tabIconName(file)} size={13} />
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
      <button
        type="button"
        class="ftb-search"
        onClick={props.onRequestFileSearch}
        title="Search files"
        aria-label="Search files"
      >
        <Plus size={14} strokeWidth={2} />
      </button>
    </div>
  )
}
