/**
 * GitHunkActions — File-level and hunk-level stage/unstage/revert controls.
 *
 * Phase 3: Extracts hunks from raw unified-diff text by splitting at @@ headers,
 * and renders per-hunk action buttons. The hunk patch text is sent to the
 * main process for git-apply.
 */

import { createMemo, createSignal, For, Show } from 'solid-js'
import type { GitFileDiff } from '../../lib/ipc'
import type { DiffScope } from './DiffScopeSwitcher'
import { countDiffLines } from '../../lib/diffCount'
import { hunkHeading, splitRawPatch } from './hunkUtils'

interface GitHunkActionsProps {
  diff: GitFileDiff
  scope: DiffScope
  onStageFile: () => void | Promise<void>
  onUnstageFile: () => void | Promise<void>
  onRevertFile: () => void | Promise<void>
  onStageHunk: (hunkPatch: string) => void | Promise<void>
  onUnstageHunk: (hunkPatch: string) => void | Promise<void>
  onRevertHunk: (hunkPatch: string) => void | Promise<void>
  /** Whether the file is currently staged in the index. */
  isStaged: boolean
  /** Disable buttons while an operation is in flight. */
  processing?: boolean
  /** Confirmation function — return false to abort. */
  confirm?: (action: string, detail: string) => boolean
}

export function GitHunkActions(props: GitHunkActionsProps) {
  const [showHunks, setShowHunks] = createSignal(false)
  const [hunkResults, setHunkResults] = createSignal<Record<number, string>>({})
  const [fileBusy, setFileBusy] = createSignal<string | null>(null)

  const hunks = createMemo(() => splitRawPatch(props.diff.rawPatch))
  const hunkCount = createMemo(() => hunks().length)

  const showStage = () => props.scope === 'unstaged'
  const showUnstage = () => props.scope === 'staged'
  const showRevert = () => props.scope === 'unstaged'

  const doConfirm = (action: string, detail: string): boolean => {
    if (props.confirm) return props.confirm(action, detail)
    return true
  }

  const handleFileAction = async (action: string, fn: () => void | Promise<void>) => {
    if (fileBusy() !== null || props.processing) return
    if (action === 'revert' || action === 'unstage') {
      const label = action === 'revert' ? 'Revert file' : 'Unstage file'
      if (!doConfirm(label, `Discard changes in ${props.diff.path}?`)) return
    }
    setFileBusy(action)
    try {
      await fn()
    } finally {
      setFileBusy(null)
    }
  }

  const handleHunkAction = async (
    action: string,
    index: number,
    hunkPatch: string,
    fn: (patch: string) => void | Promise<void>
  ) => {
    if (props.processing || hunkResults()[index] !== undefined) return
    if (action === 'revert' || action === 'unstage') {
      const label = action === 'revert' ? 'Revert hunk' : 'Unstage hunk'
      if (!doConfirm(label, `Discard changes in hunk ${index + 1} of ${props.diff.path}?`)) return
    }
    try {
      await fn(hunkPatch)
      setHunkResults((prev) => ({
        ...prev,
        [index]: `${action === 'revert' ? 'Reverted' : action === 'unstage' ? 'Unstaged' : 'Staged'} hunk.`,
      }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setHunkResults((prev) => ({ ...prev, [index]: `Failed: ${msg}` }))
    }
  }

  return (
    <div class="git-hunk-actions">
      <div class="git-hunk-file-bar">
        <span class="git-hunk-file-label">
          {props.isStaged ? 'Staged' : 'Unstaged'}
          <Show when={hunkCount() > 0}>
            {' · '}
            {hunkCount()} hunk{hunkCount() !== 1 ? 's' : ''}
          </Show>
        </span>

        <div class="git-hunk-file-buttons">
          <Show when={showStage()}>
            <button
              type="button"
              class="git-hunk-btn git-hunk-btn-stage"
              disabled={fileBusy() !== null || props.processing}
              onClick={() => void handleFileAction('stage', props.onStageFile)}
              title="Stage entire file"
            >
              {fileBusy() === 'stage' ? '…' : 'Stage file'}
            </button>
          </Show>

          <Show when={showUnstage()}>
            <button
              type="button"
              class="git-hunk-btn git-hunk-btn-unstage"
              disabled={fileBusy() !== null || props.processing}
              onClick={() => void handleFileAction('unstage', props.onUnstageFile)}
              title="Unstage entire file"
            >
              {fileBusy() === 'unstage' ? '…' : 'Unstage file'}
            </button>
          </Show>

          <Show when={showRevert()}>
            <button
              type="button"
              class="git-hunk-btn git-hunk-btn-revert"
              disabled={fileBusy() !== null || props.processing}
              onClick={() => void handleFileAction('revert', props.onRevertFile)}
              title="Revert entire file (discard working tree changes)"
            >
              {fileBusy() === 'revert' ? '…' : 'Revert file'}
            </button>
          </Show>

          <Show when={hunkCount() > 1}>
            <button
              type="button"
              class="git-hunk-toggle"
              onClick={() => setShowHunks(!showHunks())}
              title={showHunks() ? 'Collapse hunks' : 'Expand hunks'}
            >
              {showHunks() ? '▲ Hunks' : `▼ ${hunkCount()} hunks`}
            </button>
          </Show>
        </div>
      </div>

      <Show when={showHunks() && hunkCount() > 0}>
        <div class="git-hunk-list">
          <For each={hunks()}>
            {(hunkPatch, index) => {
              const counts = countDiffLines(hunkPatch)
              const result = () => hunkResults()[index()]
              return (
                <div class="git-hunk-item" data-hunk-index={index()}>
                  <div class="git-hunk-header">
                    <code class="git-hunk-heading">{hunkHeading(hunkPatch)}</code>
                    <span class="git-hunk-lines-count">
                      +{counts.added}/-{counts.removed}
                    </span>
                    <Show when={result()}>
                      <span class="git-hunk-result">{result()}</span>
                    </Show>
                  </div>
                  <div class="git-hunk-buttons">
                    <Show when={showStage()}>
                      <button
                        type="button"
                        class="git-hunk-btn git-hunk-btn-stage git-hunk-btn-sm"
                        disabled={props.processing || !!result()}
                        onClick={() =>
                          void handleHunkAction('stage', index(), hunkPatch, props.onStageHunk)
                        }
                        title="Stage this hunk"
                      >
                        Stage
                      </button>
                    </Show>

                    <Show when={showUnstage()}>
                      <button
                        type="button"
                        class="git-hunk-btn git-hunk-btn-unstage git-hunk-btn-sm"
                        disabled={props.processing || !!result()}
                        onClick={() =>
                          void handleHunkAction('unstage', index(), hunkPatch, props.onUnstageHunk)
                        }
                        title="Unstage this hunk"
                      >
                        Unstage
                      </button>
                    </Show>

                    <Show when={showRevert()}>
                      <button
                        type="button"
                        class="git-hunk-btn git-hunk-btn-revert git-hunk-btn-sm"
                        disabled={props.processing || !!result()}
                        onClick={() =>
                          void handleHunkAction('revert', index(), hunkPatch, props.onRevertHunk)
                        }
                        title="Revert this hunk (discard working tree changes)"
                      >
                        Revert
                      </button>
                    </Show>
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
