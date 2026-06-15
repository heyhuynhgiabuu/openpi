import { GripVertical } from 'lucide-solid'
import { Show } from 'solid-js'
import type { GitStatusResult } from '../../lib/ipc'
import type { GitPanelTab } from './gitPanelTypes'

interface GitPanelHeaderProps {
  activeTab: GitPanelTab
  totalChanged: number
  status: GitStatusResult | null
  onActiveTabChange: (tab: GitPanelTab) => void
  onDragHandleMouseDown?: (event: MouseEvent) => void
}

export function GitPanelHeader(props: GitPanelHeaderProps) {
  return (
    <div class={`git-panel-header${props.onDragHandleMouseDown ? ' has-drag-grip' : ''}`}>
      <Show when={props.onDragHandleMouseDown}>
        <button
          type="button"
          class="panel-drag-grip"
          title="Drag to move panel to the other side"
          aria-label="Drag panel"
          onMouseDown={props.onDragHandleMouseDown}
        >
          <GripVertical size={13} />
        </button>
      </Show>
      <div class="git-panel-tab-bar">
        <div class="git-panel-tabs">
          <button
            type="button"
            class={`git-panel-tab ${props.activeTab === 'changes' ? 'is-active' : ''}`}
            onClick={() => props.onActiveTabChange('changes')}
          >
            Changes
            <Show when={props.totalChanged > 0}>
              <span class="git-panel-tab-count">{props.totalChanged}</span>
            </Show>
          </button>
        </div>
      </div>

      <Show
        when={
          props.status?.stashCount ||
          props.status?.operation !== 'none' ||
          props.status?.hasConflicts
        }
      >
        <div class="git-status-strip">
          <Show when={props.status?.stashCount}>
            <span class="git-meta-chip">stash {props.status?.stashCount}</span>
          </Show>
          <Show when={props.status?.operation !== 'none'}>
            <span class="git-warning-chip">{props.status?.operation} in progress</span>
          </Show>
          <Show when={props.status?.hasConflicts}>
            <span class="git-warning-chip">conflicts</span>
          </Show>
        </div>
      </Show>
    </div>
  )
}
