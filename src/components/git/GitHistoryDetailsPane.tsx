import { createEffect, createMemo, createSignal, For, Show } from 'solid-js'
import type { GitHistoryCommit } from '../../lib/ipc'
import { parseFileStats, parseGitHubUrl } from './gitHelpers'

export interface GitHistoryDetailsPaneProps {
  commit: GitHistoryCommit
  onCommitFileClick?: (commitHash: string, filePath: string, allFilePaths: string[]) => void
}

export function GitHistoryDetailsPane(props: GitHistoryDetailsPaneProps) {
  const formattedDate = createMemo(() => {
    const timestamp = Date.parse(props.commit.date)
    if (!Number.isFinite(timestamp)) return props.commit.date
    const dt = new Date(timestamp)
    return dt.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  })

  const statsData = createMemo(() => parseFileStats(props.commit.stats))
  const [gitHubBaseUrl, setGitHubBaseUrl] = createSignal<string | null>(null)
  const [remoteLoaded, setRemoteLoaded] = createSignal(false)

  createEffect(() => {
    if (!remoteLoaded()) {
      void window.openpi.getGitRemoteUrl().then((url) => {
        if (url) setGitHubBaseUrl(parseGitHubUrl(url))
        setRemoteLoaded(true)
      })
    }
  })

  const handleFileClick = (filePath: string) => {
    const files = statsData().files
    if (props.onCommitFileClick && files.length > 0) {
      props.onCommitFileClick(props.commit.hash, filePath, files)
    }
  }

  const handleOpenOnGitHub = () => {
    const base = gitHubBaseUrl()
    if (base) {
      void window.openpi.openExternal(`${base}/commit/${props.commit.hash}`)
    }
  }

  return (
    <div class="git-history-details-pane">
      <div class="git-history-details-header">
        <div class="git-history-details-sha">
          <span class="label">Commit</span>
          <code>{props.commit.hash}</code>
        </div>
        <Show when={gitHubBaseUrl()}>
          <button
            type="button"
            class="git-history-open-gh-btn"
            onClick={handleOpenOnGitHub}
            title="Open on GitHub"
            aria-label="Open on GitHub"
          >
            Open on GitHub
          </button>
        </Show>
      </div>
      <div class="git-history-details-row">
        <span class="label">Author</span>
        <span>
          {props.commit.authorName} ({props.commit.authorEmail})
        </span>
      </div>
      <div class="git-history-details-row">
        <span class="label">Date</span>
        <span>{formattedDate()}</span>
      </div>
      <Show when={props.commit.refs}>
        <div class="git-history-details-row">
          <span class="label">Refs</span>
          <span class="git-history-refs">{props.commit.refs}</span>
        </div>
      </Show>
      <div class="git-history-details-message">
        <span class="label">Message</span>
        <pre>{props.commit.message}</pre>
      </div>
      <Show when={statsData().files.length > 0}>
        <div class="git-history-details-files">
          <div class="git-history-files-header">
            <span class="label">{statsData().files.length} Changed Files</span>
            <span class="git-history-file-stats">
              <span class="git-delta-add">+{statsData().added}</span>
              <span class="git-delta-rem">-{statsData().removed}</span>
            </span>
          </div>
          <div class="git-history-files-list">
            <For each={statsData().files}>
              {(file) => (
                <button
                  type="button"
                  class="git-history-file-item git-history-file-btn"
                  onClick={() => handleFileClick(file)}
                  title={`View diff for ${file}`}
                >
                  <span class="git-history-file-name">{file}</span>
                </button>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  )
}
