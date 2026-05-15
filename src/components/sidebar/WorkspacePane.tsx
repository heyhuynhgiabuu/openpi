import { FolderOpen, FolderPlus, Plus } from 'lucide-solid'
import { For, Show } from 'solid-js'
import type { WorkspaceInfo } from '../../lib/ipc'
import { formatRelativeTime } from '../../lib/sessionView'

type WorkspacePaneProps = {
  style?: Record<string, string>
  workspaces: WorkspaceInfo[]
  selectedPath?: string | null
  activePath?: string | null
  onSelectWorkspace: (path: string) => void
  onOpenWorkspace: () => void
  onNewSessionIn: (workspacePath: string) => void
}

export function WorkspacePane(props: WorkspacePaneProps) {
  return (
    <aside class="workspace-pane" style={props.style} aria-label="Workspaces">
      <header class="workspace-pane-header">
        <div>
          <div class="eyebrow">Workspace</div>
          <div class="workspace-pane-subtitle">Projects and recent roots</div>
        </div>
        <button
          type="button"
          class="icon-button no-drag"
          title="Open workspace"
          aria-label="Open workspace"
          onClick={props.onOpenWorkspace}
        >
          <FolderPlus size={15} />
        </button>
      </header>

      <div class="workspace-pane-list">
        <For
          each={props.workspaces}
          fallback={<div class="workspace-pane-empty">No workspaces indexed yet.</div>}
        >
          {(workspace) => {
            const isSelected = () => props.selectedPath === workspace.path
            const isActive = () => props.activePath === workspace.path
            return (
              <article
                class={`workspace-card${isSelected() ? ' is-selected' : ''}${isActive() ? ' is-active' : ''}`}
              >
                <button
                  type="button"
                  class="workspace-card-main"
                  title={workspace.path}
                  onClick={() => props.onSelectWorkspace(workspace.path)}
                >
                  <span class="workspace-card-icon">
                    <FolderOpen size={15} />
                  </span>
                  <span class="workspace-card-copy">
                    <span class="workspace-card-name">{workspace.displayName}</span>
                    <span class="workspace-card-path">{workspace.path}</span>
                    <span class="workspace-card-meta">
                      {workspace.sessionCount} thread{workspace.sessionCount === 1 ? '' : 's'}
                      <Show when={workspace.lastOpenedAt}>
                        {(lastOpenedAt) => <> · {formatRelativeTime(lastOpenedAt())}</>}
                      </Show>
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  class="workspace-card-new"
                  title="New thread in workspace"
                  aria-label={`New thread in ${workspace.displayName}`}
                  onClick={() => props.onNewSessionIn(workspace.path)}
                >
                  <Plus size={14} />
                </button>
              </article>
            )
          }}
        </For>
      </div>
    </aside>
  )
}
