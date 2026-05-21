import { ArrowUp, ArrowUpDown, ChevronDown, Sparkles } from 'lucide-solid'
import { createSignal, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import type { GitSyncAction } from '../../lib/ipc'

interface GitCommitAreaProps {
  commitMessage: string
  isCommitting: boolean
  isGeneratingMessage: boolean
  commitOptionsOpen: boolean
  commitAmend: boolean
  commitSignoff: boolean
  commitError: string | null
  syncingAction: GitSyncAction | null
  syncBlocked: boolean
  hasUpstream: boolean
  totalChanged: number
  onCommitMessageChange: (message: string) => void
  onGenerateCommitMessage: () => void
  onCommit: (push: boolean) => void
  onCommitOptionsOpenChange: (open: boolean) => void
  onCommitAmendChange: (value: boolean) => void
  onCommitSignoffChange: (value: boolean) => void
  onSync: (action: GitSyncAction) => void
}

export function GitCommitArea(props: GitCommitAreaProps) {
  const [syncMenuOpen, setSyncMenuOpen] = createSignal(false)
  const [syncMenuAnchor, setSyncMenuAnchor] = createSignal<DOMRect | null>(null)
  let syncBtnRef: HTMLButtonElement | undefined

  const commitDisabled = () => props.isCommitting || !props.commitMessage.trim()
  const canPull = () => !props.syncBlocked && props.hasUpstream && props.totalChanged === 0

  return (
    <div class="git-commit-area">
      <div class="git-commit-composer">
        <textarea
          class="git-commit-input"
          placeholder="Enter commit message"
          value={props.commitMessage}
          onInput={(e) => props.onCommitMessageChange(e.currentTarget.value)}
          rows={4}
          disabled={props.isCommitting}
        />
        <div class="git-commit-composer-footer">
          <div class="git-commit-footer-left">
            <button
              type="button"
              class="git-generate-msg-btn"
              title="Generate commit message from staged diff"
              aria-label="Generate commit message from staged diff"
              disabled={props.isGeneratingMessage || props.isCommitting}
              onClick={props.onGenerateCommitMessage}
            >
              <Show
                when={!props.isGeneratingMessage}
                fallback={<span class="git-generate-spinner">⋯</span>}
              >
                <Sparkles size={14} />
              </Show>
            </button>
            <button
              ref={(el) => {
                syncBtnRef = el
              }}
              type="button"
              class={`git-icon-btn${syncMenuOpen() ? ' is-active' : ''}`}
              disabled={props.syncBlocked}
              title={props.syncingAction ? 'Syncing…' : 'Sync remote'}
              aria-label="Sync with remote"
              aria-expanded={syncMenuOpen()}
              onClick={() => {
                setSyncMenuAnchor(syncBtnRef?.getBoundingClientRect() ?? null)
                setSyncMenuOpen((value) => !value)
              }}
            >
              <ArrowUpDown size={14} />
            </button>
            <Show when={syncMenuOpen() && syncMenuAnchor()}>
              {(anchor) => (
                <Portal>
                  <div
                    role="presentation"
                    aria-hidden="true"
                    class="git-sync-backdrop"
                    onClick={() => setSyncMenuOpen(false)}
                  />
                  <div
                    class="git-sync-popover git-sync-popover--portal"
                    style={{
                      bottom: `${window.innerHeight - anchor().top + 4}px`,
                      left: `${anchor().left}px`,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => handleSync('fetch')}
                      disabled={props.syncBlocked}
                    >
                      Fetch
                    </button>
                    <button type="button" onClick={() => handleSync('pull')} disabled={!canPull()}>
                      Pull
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSync('pull-rebase')}
                      disabled={!canPull()}
                    >
                      Pull (Rebase)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSync('push')}
                      disabled={props.syncBlocked || !props.hasUpstream}
                    >
                      Push
                    </button>
                    <button
                      type="button"
                      disabled
                      title="Force push requires protected-action confirmation"
                    >
                      Force Push
                    </button>
                  </div>
                </Portal>
              )}
            </Show>
          </div>
          <div class="git-commit-mode-actions">
            <button
              type="button"
              class="git-commit-mode-btn"
              onClick={() => props.onCommit(false)}
              disabled={commitDisabled()}
            >
              {props.isCommitting
                ? 'Committing…'
                : props.commitAmend
                  ? 'Amend Staged'
                  : 'Commit Staged'}
            </button>
            <button
              type="button"
              class={`git-commit-mode-menu-btn ${props.commitOptionsOpen ? 'is-active' : ''}`}
              disabled={commitDisabled()}
              title="Commit options"
              aria-label="Commit options"
              aria-expanded={props.commitOptionsOpen}
              onClick={() => props.onCommitOptionsOpenChange(!props.commitOptionsOpen)}
            >
              <ChevronDown size={14} />
            </button>
            <Show when={props.commitOptionsOpen}>
              <div class="git-commit-options-menu">
                <button
                  type="button"
                  class="git-commit-option-row"
                  onClick={() => props.onCommitAmendChange(!props.commitAmend)}
                >
                  <span class="git-commit-option-check">{props.commitAmend ? '✓' : ''}</span>
                  <span>
                    <strong>Amend</strong>
                  </span>
                </button>
                <button
                  type="button"
                  class="git-commit-option-row"
                  onClick={() => props.onCommitSignoffChange(!props.commitSignoff)}
                >
                  <span class="git-commit-option-check">{props.commitSignoff ? '✓' : ''}</span>
                  <span>
                    <strong>Signoff</strong>
                  </span>
                </button>
              </div>
            </Show>
            <button
              type="button"
              class="git-commit-push-btn"
              onClick={() => props.onCommit(true)}
              disabled={commitDisabled()}
              title="Commit and push"
              aria-label="Commit and push"
            >
              <ArrowUp size={14} />
            </button>
          </div>
        </div>
      </div>
      <Show when={props.commitError}>
        <div class="git-commit-error">{props.commitError}</div>
      </Show>
    </div>
  )

  function handleSync(action: GitSyncAction) {
    setSyncMenuOpen(false)
    props.onSync(action)
  }
}
