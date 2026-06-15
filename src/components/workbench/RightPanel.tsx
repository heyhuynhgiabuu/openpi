/**
 * RightPanel — source control + file tree tabs.
 */
import { createSignal, Show } from 'solid-js'
import type { GitChangedFile, GitFileDiff, GitSyncAction } from '../../lib/ipc'
import { FileTree } from '../git/FileTree'
import { GitPanel } from '../git/GitPanel'

interface Props {
  visible: boolean
  cwd: string
  width: number
  onResize: (delta: number) => void
  changeCount: number | null
  onDiffOpen: (diff: GitFileDiff, files: GitChangedFile[], index: number) => void
  onCommitFileClick?: (commitHash: string, filePath: string, allFilePaths: string[]) => void
  onFileClick: (relPath: string) => void
  onFileDeleted: (relPath: string, isDir: boolean) => void
  onFileRenamed: (oldPath: string, newPath: string) => void
  onSyncLabelChange?: (label: string) => void
  onSyncActionChange?: (action: GitSyncAction | null) => void
  onSyncMessageChange?: (message: string | null) => void
}

export function RightPanel(props: Props) {
  const [sidebarTab, setSidebarTab] = createSignal<'changes' | 'files'>('files')

  return (
    <div class="rp-container" style={{ width: `${props.width}px` }}>
      <Show when={props.visible}>
        <div class="rp-sidebar-tabs">
          <button
            type="button"
            class={`rp-sidebar-tab${sidebarTab() === 'changes' ? ' is-active' : ''}`}
            onClick={() => setSidebarTab('changes')}
          >
            <Show when={props.changeCount && props.changeCount > 0} fallback="Changes">
              <span class="rp-badge">{props.changeCount}</span>
              {' Changes'}
            </Show>
          </button>
          <button
            type="button"
            class={`rp-sidebar-tab${sidebarTab() === 'files' ? ' is-active' : ''}`}
            onClick={() => setSidebarTab('files')}
          >
            All files
          </button>
        </div>

        <div class="rp-sidebar-content">
          <Show when={sidebarTab() === 'changes'}>
            <GitPanel
              cwd={props.cwd}
              activeTab="changes"
              hideHeader
              side="right"
              style={{ height: '100%', width: '100%', border: '0' }}
              onDiffOpen={props.onDiffOpen}
              onCommitFileClick={props.onCommitFileClick}
              onSyncLabelChange={props.onSyncLabelChange}
              onSyncActionChange={props.onSyncActionChange}
              onSyncMessageChange={props.onSyncMessageChange}
            />
          </Show>

          <Show when={sidebarTab() === 'files'}>
            <FileTree
              cwd={props.cwd}
              onFileClick={(path) => props.onFileClick(path)}
              onFileDeleted={props.onFileDeleted}
              onFileRenamed={props.onFileRenamed}
            />
          </Show>
        </div>
      </Show>
    </div>
  )
}
