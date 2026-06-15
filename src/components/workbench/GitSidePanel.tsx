import { Show } from 'solid-js'
import type { GitChangedFile, GitFileDiff, GitSyncAction } from '../../lib/ipc'
import type { GitPanelSide } from '../../lib/panelLayout'
import { GitPanel } from '../git/GitPanel'
import type { GitPanelTab } from '../git/gitPanelTypes'
import { ResizeHandle } from '../ResizeHandle'

interface GitSidePanelProps {
  visible: boolean
  side: GitPanelSide
  cwd: string
  width: number
  activeTab: GitPanelTab
  onActiveTabChange: (tab: GitPanelTab) => void
  onDragStart: (event: MouseEvent) => void
  onResize: (delta: number) => void
  onRequestFileSearch: () => void
  onDiffOpen: (diff: GitFileDiff, files: GitChangedFile[], index: number) => void
  onCommitFileClick: (commitHash: string, filePath: string, allFilePaths: string[]) => void
  onFileClick: (relPath: string) => void
  onSyncLabelChange: (label: string) => void
  onSyncActionChange: (action: GitSyncAction | null) => void
  onSyncMessageChange: (message: string | null) => void
  onOpenHistory: () => void
}

export function GitSidePanel(props: GitSidePanelProps) {
  return (
    <Show when={props.visible}>
      <Show when={props.side === 'right'}>
        <ResizeHandle direction="horizontal" onResize={props.onResize} />
      </Show>
      <div class="secondary-panel-drag-handle">
        <button
          type="button"
          class="panel-drag-grip"
          title="Drag to move panel to the other side"
          aria-label="Drag panel"
          onMouseDown={props.onDragStart}
        >
          ⋮⋮
        </button>
      </div>
      <Show when={props.side === 'left'}>
        <PanelBody {...props} />
        <ResizeHandle direction="horizontal" onResize={props.onResize} />
      </Show>
      <Show when={props.side === 'right'}>
        <PanelBody {...props} />
      </Show>
    </Show>
  )
}

function PanelBody(props: GitSidePanelProps) {
  return (
    <div
      class="secondary-panel"
      style={{
        width: `${props.width}px`,
        display: 'flex',
        'flex-direction': 'column',
        'min-width': '0',
      }}
    >
      <GitPanel
        style={{ width: '100%', height: '100%' }}
        side={props.side}
        cwd={props.cwd}
        activeTab={props.activeTab}
        onActiveTabChange={props.onActiveTabChange}
        onRequestFileSearch={props.onRequestFileSearch}
        onDiffOpen={props.onDiffOpen}
        onCommitFileClick={props.onCommitFileClick}
        onFileClick={props.onFileClick}
        onSyncLabelChange={props.onSyncLabelChange}
        onSyncActionChange={props.onSyncActionChange}
        onSyncMessageChange={props.onSyncMessageChange}
        onOpenHistory={props.onOpenHistory}
      />
    </div>
  )
}
