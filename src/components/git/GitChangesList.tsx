import { For, Show } from 'solid-js'
import type { GitChangedFile } from '../../lib/ipc'
import { GitFileRow } from './GitFileRow'

interface GitChangesListProps {
  statusLoaded: boolean
  totalChanged: number
  showingAgentFiles: boolean
  stageableFiles: GitChangedFile[]
  pinnedAgentFiles: GitChangedFile[]
  conflictFiles: GitChangedFile[]
  stagedFiles: GitChangedFile[]
  unstagedFiles: GitChangedFile[]
  untrackedFiles: GitChangedFile[]
  loadingDiff: string | null
  onStageAll: () => void
  onShowAllChanges: () => void
  onFileClick: (file: GitChangedFile) => void
  onStageToggle: (file: GitChangedFile, event: Event) => void
}

export function GitChangesList(props: GitChangesListProps) {
  return (
    <Show
      when={props.statusLoaded}
      fallback={<div class="git-panel-empty">Loading git status…</div>}
    >
      <Show when={!props.showingAgentFiles && props.totalChanged === 0}>
        <div class="git-panel-empty">No changes to commit</div>
      </Show>

      <Show when={props.showingAgentFiles || props.totalChanged > 0}>
        <Show when={props.stageableFiles.length > 0}>
          <div class="git-worktree-actions">
            <span>{props.stageableFiles.length} unstaged</span>
            <button type="button" class="git-stage-all-btn" onClick={props.onStageAll}>
              Stage All
            </button>
          </div>
        </Show>

        <Show when={props.showingAgentFiles && props.pinnedAgentFiles.length === 0}>
          <div class="git-panel-empty">Agent-changed files have been committed or reverted</div>
        </Show>

        <FileSection
          title="✨ Agent Changed"
          className="git-section git-section--agent"
          files={props.showingAgentFiles ? props.pinnedAgentFiles : []}
          loadingDiff={props.loadingDiff}
          onFileClick={props.onFileClick}
          onStageToggle={props.onStageToggle}
          extraTitleContent={
            <button type="button" class="git-show-all-btn" onClick={props.onShowAllChanges}>
              Show all changes
            </button>
          }
        />
        <FileSection
          title="Conflicts"
          className="git-section git-section--conflicts"
          files={props.conflictFiles}
          loadingDiff={props.loadingDiff}
          onFileClick={props.onFileClick}
          onStageToggle={props.onStageToggle}
        />
        <FileSection
          title="Staged"
          files={props.stagedFiles}
          loadingDiff={props.loadingDiff}
          onFileClick={props.onFileClick}
          onStageToggle={props.onStageToggle}
        />
        <FileSection
          title="Changes"
          files={props.unstagedFiles}
          loadingDiff={props.loadingDiff}
          onFileClick={props.onFileClick}
          onStageToggle={props.onStageToggle}
        />
        <FileSection
          title="Untracked"
          files={props.untrackedFiles}
          loadingDiff={props.loadingDiff}
          onFileClick={props.onFileClick}
          onStageToggle={props.onStageToggle}
        />
      </Show>
    </Show>
  )
}

interface FileSectionProps {
  title: string
  files: GitChangedFile[]
  loadingDiff: string | null
  className?: string
  extraTitleContent?: import('solid-js').JSX.Element
  onFileClick: (file: GitChangedFile) => void
  onStageToggle: (file: GitChangedFile, event: Event) => void
}

function FileSection(props: FileSectionProps) {
  return (
    <Show when={props.files.length > 0}>
      <section class={props.className ?? 'git-section'}>
        <div class="git-section-title">
          <span>{props.title}</span>
          <span class="git-section-count">{props.files.length}</span>
          {props.extraTitleContent}
        </div>
        <For each={props.files}>
          {(file) => (
            <GitFileRow
              file={file}
              loadingDiff={props.loadingDiff}
              onFileClick={props.onFileClick}
              onStageToggle={props.onStageToggle}
            />
          )}
        </For>
      </section>
    </Show>
  )
}
