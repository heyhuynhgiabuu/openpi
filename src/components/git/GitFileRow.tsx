import { Show } from 'solid-js'
import type { GitChangedFile } from '../../lib/ipc'

const STATUS_LABEL: Record<string, string> = {
  M: 'M',
  A: 'A',
  D: 'D',
  '?': '?',
  U: 'U',
}

const STATUS_CLASS: Record<string, string> = {
  M: 'git-badge-m',
  A: 'git-badge-a',
  D: 'git-badge-d',
  '?': 'git-badge-q',
  U: 'git-badge-u',
}

interface GitFileRowProps {
  file: GitChangedFile
  loadingDiff: string | null
  onFileClick: (f: GitChangedFile) => void
  onStageToggle: (f: GitChangedFile, e: Event) => void
}

export function GitFileRow(props: GitFileRowProps) {
  const parts = props.file.path.split('/')
  const filename = parts.pop() ?? props.file.path
  const dir = parts.join('/') || null
  const isLoading = () => props.loadingDiff === props.file.path

  return (
    <div class={`git-file-row ${isLoading() ? 'is-loading' : ''}`}>
      <button
        type="button"
        class={`git-stage-check ${props.file.staged ? 'is-staged' : ''}`}
        aria-label={props.file.staged ? `Unstage ${props.file.path}` : `Stage ${props.file.path}`}
        onClick={(e) => props.onStageToggle(props.file, e)}
        title={props.file.staged ? 'Unstage' : 'Stage'}
      >
        {props.file.staged ? '✓' : '○'}
      </button>

      <button type="button" class="git-file-open-btn" onClick={() => props.onFileClick(props.file)}>
        <span class="git-file-name">
          {filename}
          <Show when={dir}>
            <span class="git-file-dir">{dir}</span>
          </Show>
        </span>

        <span class={`git-status-badge ${STATUS_CLASS[props.file.status] ?? 'git-badge-m'}`}>
          {STATUS_LABEL[props.file.status] ?? '?'}
        </span>
        <Show when={props.file.added > 0 || props.file.removed > 0}>
          <span class="git-file-delta">
            <Show when={props.file.added > 0}>
              <span class="git-delta-add">+{props.file.added}</span>
            </Show>
            <Show when={props.file.removed > 0}>
              <span class="git-delta-rem"> -{props.file.removed}</span>
            </Show>
          </span>
        </Show>
      </button>
    </div>
  )
}
