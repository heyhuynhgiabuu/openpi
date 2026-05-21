import { Search } from 'lucide-solid'
import { For, Show } from 'solid-js'
import type { GitGraphColumn, GitHistoryCommit, GitHistoryResult } from '../../lib/ipc'
import { GitHistoryDetailsPane } from './GitHistoryDetailsPane'
import { GitHistoryRow } from './GitHistoryRow'

interface GitHistoryTabProps {
  history: GitHistoryResult | null
  historyQuery: string
  historyLoading: boolean
  historyError: string | null
  selectedCommit: GitHistoryCommit | null
  graphColumnsByHash: Map<string, GitGraphColumn[]>
  maxGraphColumns: number
  onHistoryQueryChange: (query: string) => void
  onLoadHistory: (query?: string) => void
  onSelectCommit: (commit: GitHistoryCommit) => void
  onCommitFileClick?: (commitHash: string, filePath: string, allFilePaths: string[]) => void
}

export function GitHistoryTab(props: GitHistoryTabProps) {
  return (
    <div class="git-panel-body">
      <div class="git-history-search-row">
        <input
          class="git-refs-search"
          value={props.historyQuery}
          onInput={(event) => props.onHistoryQueryChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') props.onLoadHistory(event.currentTarget.value)
          }}
          placeholder="Search commits…"
        />
        <button
          type="button"
          class="git-icon-btn"
          onClick={() => props.onLoadHistory()}
          title="Search history"
          aria-label="Search history"
        >
          <Search size={16} />
        </button>
      </div>
      <div class="git-history-container">
        <Show when={props.historyLoading}>
          <div class="git-panel-empty">Loading history…</div>
        </Show>
        <Show when={props.historyError}>
          <div class="git-commit-error">{props.historyError}</div>
        </Show>
        <Show when={!props.historyLoading}>
          <div class="git-history-list">
            <Show when={(props.history?.commits.length ?? 0) === 0}>
              <div class="git-panel-empty">No commits found</div>
            </Show>
            <For each={props.history?.commits ?? []}>
              {(commit) => (
                <GitHistoryRow
                  commit={commit}
                  isSelected={props.selectedCommit?.hash === commit.hash}
                  onSelect={props.onSelectCommit}
                  graphColumns={props.graphColumnsByHash.get(commit.hash) ?? []}
                  maxGraphColumns={props.maxGraphColumns}
                />
              )}
            </For>
          </div>
          <Show when={props.selectedCommit}>
            {(commit) => (
              <GitHistoryDetailsPane
                commit={commit()}
                onCommitFileClick={props.onCommitFileClick}
              />
            )}
          </Show>
        </Show>
      </div>
    </div>
  )
}
