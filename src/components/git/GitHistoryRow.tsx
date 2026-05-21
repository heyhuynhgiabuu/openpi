import { createMemo, For, Show } from 'solid-js'
import type { GitGraphColumn, GitHistoryCommit } from '../../lib/ipc'
import { CommitGraph } from './CommitGraph'
import { parseRefBadges } from './gitHelpers'

export interface GitHistoryRowProps {
  commit: GitHistoryCommit
  isSelected: boolean
  onSelect: (commit: GitHistoryCommit) => void
  graphColumns: GitGraphColumn[]
  maxGraphColumns: number
  onCommitFileClick?: (commitHash: string, filePath: string, allFilePaths: string[]) => void
}

export function GitHistoryRow(props: GitHistoryRowProps) {
  const formattedDate = createMemo(() => {
    const timestamp = Date.parse(props.commit.date)
    if (!Number.isFinite(timestamp)) return props.commit.date
    return new Date(timestamp).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    })
  })

  return (
    <button
      type="button"
      class={`git-history-row ${props.isSelected ? 'is-selected' : ''}`}
      onClick={() => props.onSelect(props.commit)}
    >
      <div class="git-history-graph-cell">
        <CommitGraph columns={props.graphColumns} maxColumns={props.maxGraphColumns} />
      </div>
      <div class="git-history-message">
        <span>{props.commit.message}</span>
        <Show when={props.commit.refs}>
          <span class="git-history-refs">
            <For each={parseRefBadges(props.commit.refs)}>
              {(badge) => (
                <span class={`git-ref-badge git-ref-badge--${badge.type}`} title={badge.name}>
                  {badge.name}
                </span>
              )}
            </For>
          </span>
        </Show>
      </div>
      <div class="git-history-meta">
        <span>{props.commit.authorName}</span>
        <span>{formattedDate()}</span>
        <span class="git-history-sha">{props.commit.shortHash}</span>
      </div>
    </button>
  )
}
