/**
 * ReviewHunkActions — per-hunk Keep/Revert for the last-turn review diff.
 *
 * Mirrors GitHunkActions (same list layout and `git-hunk-*` styles) so hunk
 * review looks the same in both panels. Unlike the Git panel the renderer sends
 * no patch: main owns the before/after snapshots and applies the hunk it derives
 * itself, so only the hunk index travels over IPC.
 */

import { createSignal, For, Show } from 'solid-js'
import type { AgentReviewChange, AgentReviewHunk } from '../../lib/ipc'

interface ReviewHunkActionsProps {
  change: AgentReviewChange
  onKeepHunk: (index: number) => Promise<void>
  onRevertHunk: (index: number) => Promise<void>
}

function hunkHeading(hunk: AgentReviewHunk): string {
  return `@@ -${hunk.beforeStart} +${hunk.afterStart} @@`
}

export function ReviewHunkActions(props: ReviewHunkActionsProps) {
  const [showHunks, setShowHunks] = createSignal(false)
  const [results, setResults] = createSignal<Record<number, string>>({})
  const [busy, setBusy] = createSignal<number | null>(null)

  const run = async (index: number, action: 'keep' | 'revert') => {
    if (busy() !== null) return
    if (action === 'revert') {
      const ok = window.confirm(
        `Revert hunk ${index + 1} of ${props.change.hunks.length} in ${props.change.path}?`
      )
      if (!ok) return
    }
    setBusy(index)
    try {
      await (action === 'keep' ? props.onKeepHunk(index) : props.onRevertHunk(index))
      setResults((prev) => ({
        ...prev,
        [index]: action === 'keep' ? 'Kept hunk.' : 'Reverted hunk.',
      }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setResults((prev) => ({ ...prev, [index]: `Failed: ${msg}` }))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div class="git-hunk-actions">
      <div class="git-hunk-file-bar">
        <div class="git-hunk-file-buttons">
          <button
            type="button"
            class="git-hunk-toggle"
            onClick={() => setShowHunks(!showHunks())}
            title={showHunks() ? 'Collapse hunks' : 'Expand hunks'}
          >
            {showHunks() ? '▲ Hunks' : `▼ ${props.change.hunks.length} hunks`}
          </button>
        </div>
      </div>

      <Show when={showHunks()}>
        <div class="git-hunk-list">
          <For each={props.change.hunks}>
            {(hunk) => {
              const result = () => results()[hunk.index]
              return (
                <div class="git-hunk-item" data-hunk-index={hunk.index}>
                  <div class="git-hunk-header">
                    <code class="git-hunk-heading">{hunkHeading(hunk)}</code>
                    <span class="git-hunk-lines-count">
                      +{hunk.added}/-{hunk.removed}
                    </span>
                    <Show when={result()}>
                      {(text) => <span class="git-hunk-result">{text()}</span>}
                    </Show>
                  </div>
                  <div class="git-hunk-buttons">
                    <button
                      type="button"
                      class="git-hunk-btn git-hunk-btn-stage git-hunk-btn-sm"
                      disabled={busy() !== null || !!result()}
                      onClick={() => void run(hunk.index, 'keep')}
                      title="Keep this hunk (stop tracking it as a change)"
                    >
                      Keep
                    </button>
                    <button
                      type="button"
                      class="git-hunk-btn git-hunk-btn-revert git-hunk-btn-sm"
                      disabled={busy() !== null || !!result()}
                      onClick={() => void run(hunk.index, 'revert')}
                      title="Revert this hunk (restore its previous lines on disk)"
                    >
                      Revert
                    </button>
                  </div>
                </div>
              )
            }}
          </For>
        </div>
      </Show>
    </div>
  )
}
