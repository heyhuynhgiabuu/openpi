/**
 * RefsPickerPanel — standalone branch/stash picker Portal.
 *
 * Always mounted in App. Opens/closes independently of whether the git panel
 * is open. Exposes a `registerToggle` prop so App can wire TopBar's branch
 * chip click directly to this component regardless of git panel state.
 */
import { createMemo, createSignal, For, onMount, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import type { GitBranchRef, GitRefsResult, GitStashEntry } from '../../lib/ipc'

interface RefsPickerPanelProps {
  cwd: string | null
  /** Called once on mount with the toggle fn — store it to open from TopBar. */
  registerToggle: (fn: () => void) => void
  /** Called after a successful branch checkout (so GitPanel can refresh). */
  onBranchCheckedOut?: () => void
}

export function RefsPickerPanel(props: RefsPickerPanelProps) {
  let mounted = true

  const [open, setOpen] = createSignal(false)
  const [tab, setTab] = createSignal<'branches' | 'stash'>('branches')
  const [query, setQuery] = createSignal('')
  const [loading, setLoading] = createSignal(false)
  const [refs, setRefs] = createSignal<GitRefsResult | null>(null)
  const [message, setMessage] = createSignal<string | null>(null)
  const [newBranchName, setNewBranchName] = createSignal('')
  const [busyAction, setBusyAction] = createSignal<string | null>(null)

  onMount(() => {
    props.registerToggle(() => void togglePicker())
    return () => {
      mounted = false
    }
  })

  const loadRefs = async () => {
    setLoading(true)
    setMessage(null)
    try {
      const result = await window.openpi.git.getRefs()
      if (mounted && result) setRefs(result)
    } catch (err) {
      if (mounted) setMessage(String(err))
    } finally {
      if (mounted) setLoading(false)
    }
  }

  const togglePicker = async () => {
    const next = !open()
    setOpen(next)
    if (next) await loadRefs()
  }

  const handleCheckout = async (branch: GitBranchRef) => {
    if (branch.current || branch.remote) return
    setMessage(null)
    const result = await window.openpi.git.checkoutBranch(branch.name)
    if (!mounted || !result) return
    setMessage(result.output)
    if (result.ok) {
      setOpen(false)
      props.onBranchCheckedOut?.()
      await loadRefs()
    }
  }

  const handleCreateBranch = async () => {
    const name = newBranchName().trim()
    if (!name) return
    setBusyAction('creating')
    setMessage(null)
    try {
      const result = await window.openpi.git.createBranch(name)
      if (!mounted) return
      if (result?.ok) {
        setNewBranchName('')
        setMessage(result.output)
        await loadRefs()
      } else {
        setMessage(result?.output ?? 'Failed to create branch.')
      }
    } catch (err) {
      if (mounted) setMessage(String(err))
    } finally {
      if (mounted) setBusyAction(null)
    }
  }

  const handleStashAction = async (action: 'apply' | 'pop' | 'drop', stash: GitStashEntry) => {
    setBusyAction(`${action}:${stash.index}`)
    setMessage(null)
    try {
      let result: Awaited<ReturnType<typeof window.openpi.git.stashApply>>
      if (action === 'apply') result = await window.openpi.git.stashApply(stash.index)
      else if (action === 'pop') result = await window.openpi.git.stashPop(stash.index)
      else result = await window.openpi.git.stashDrop(stash.index)

      if (!mounted) return
      if (result?.ok) {
        setMessage(result.output)
        await loadRefs()
      } else {
        setMessage(result?.output ?? `Failed to ${action} stash.`)
      }
    } catch (err) {
      if (mounted) setMessage(String(err))
    } finally {
      if (mounted) setBusyAction(null)
    }
  }

  const branchMatchesQuery = (branch: GitBranchRef) =>
    branch.name.toLowerCase().includes(query().trim().toLowerCase())

  const localBranches = createMemo(
    () => refs()?.branches.filter((b) => !b.remote && branchMatchesQuery(b)) ?? []
  )
  const remoteBranches = createMemo(
    () => refs()?.branches.filter((b) => b.remote && branchMatchesQuery(b)) ?? []
  )
  const visibleStashes = createMemo(() => {
    const q = query().trim().toLowerCase()
    return q
      ? (refs()?.stashes.filter((s) => s.message.toLowerCase().includes(q)) ?? [])
      : (refs()?.stashes ?? [])
  })

  return (
    <Show when={open()}>
      <Portal>
        <div
          role="presentation"
          aria-hidden="true"
          class="git-refs-backdrop"
          onClick={() => setOpen(false)}
        />
        <div class="git-refs-picker git-refs-picker--floating">
          <div class="git-refs-tabs">
            <button
              type="button"
              class={tab() === 'branches' ? 'is-active' : ''}
              onClick={() => setTab('branches')}
            >
              Branches
            </button>
            <button
              type="button"
              class={tab() === 'stash' ? 'is-active' : ''}
              onClick={() => setTab('stash')}
            >
              Stash
              <Show when={refs()?.stashes.length}> ({refs()?.stashes.length})</Show>
            </button>
          </div>
          <input
            class="git-refs-search"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            placeholder={tab() === 'branches' ? 'Switch branch…' : 'Search stashes…'}
          />
          <Show when={loading()}>
            <div class="git-refs-empty">Loading refs…</div>
          </Show>
          <Show when={!loading() && tab() === 'branches'}>
            <div class="git-refs-list">
              <Show when={localBranches().length === 0 && remoteBranches().length === 0}>
                <div class="git-refs-empty">No branches found</div>
              </Show>
              <Show when={localBranches().length > 0}>
                <div class="git-refs-group-title">Local</div>
                <For each={localBranches()}>
                  {(branch) => (
                    <button
                      type="button"
                      class="git-ref-row"
                      disabled={branch.current}
                      onClick={() => void handleCheckout(branch)}
                    >
                      <span>{branch.current ? '✓' : ''}</span>
                      <span>{branch.name}</span>
                      <span>{branch.commit.slice(0, 7)}</span>
                    </button>
                  )}
                </For>
              </Show>
              <Show when={remoteBranches().length > 0}>
                <div class="git-refs-group-title">Remote</div>
                <For each={remoteBranches()}>
                  {(branch) => (
                    <button type="button" class="git-ref-row" disabled>
                      <span />
                      <span>{branch.name.replace(/^remotes\//, '')}</span>
                      <span>{branch.commit.slice(0, 7)}</span>
                    </button>
                  )}
                </For>
              </Show>
              <div class="git-create-branch-row">
                <input
                  class="git-create-branch-input"
                  value={newBranchName()}
                  onInput={(e) => setNewBranchName(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !busyAction()) void handleCreateBranch()
                  }}
                  placeholder="New branch name…"
                  disabled={busyAction() === 'creating'}
                />
                <button
                  type="button"
                  class="git-create-branch-btn"
                  onClick={() => void handleCreateBranch()}
                  disabled={busyAction() === 'creating' || !newBranchName().trim()}
                >
                  {busyAction() === 'creating' ? '…' : '+'}
                </button>
              </div>
            </div>
          </Show>
          <Show when={!loading() && tab() === 'stash'}>
            <div class="git-refs-list">
              <Show when={visibleStashes().length === 0}>
                <div class="git-refs-empty">No stashes found</div>
              </Show>
              <For each={visibleStashes()}>
                {(stash) => {
                  const busy = () =>
                    busyAction() === `apply:${stash.index}` ||
                    busyAction() === `pop:${stash.index}` ||
                    busyAction() === `drop:${stash.index}`
                  return (
                    <div class="git-stash-row">
                      <div class="git-stash-info">
                        <span class="git-stash-ref">{`stash@{${stash.index}}`}</span>
                        <span class="git-stash-message">{stash.message}</span>
                      </div>
                      <div class="git-stash-actions">
                        <button
                          type="button"
                          class="git-stash-action-btn git-stash-action-btn--apply"
                          onClick={() => void handleStashAction('apply', stash)}
                          disabled={busy()}
                          title="Apply stash"
                          aria-label="Apply stash"
                        >
                          Apply
                        </button>
                        <button
                          type="button"
                          class="git-stash-action-btn git-stash-action-btn--pop"
                          onClick={() => void handleStashAction('pop', stash)}
                          disabled={busy()}
                          title="Pop stash"
                          aria-label="Pop stash"
                        >
                          Pop
                        </button>
                        <button
                          type="button"
                          class="git-stash-action-btn git-stash-action-btn--drop"
                          onClick={() => void handleStashAction('drop', stash)}
                          disabled={busy()}
                          title="Drop stash"
                          aria-label="Drop stash"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  )
                }}
              </For>
            </div>
          </Show>
          <Show when={message()}>
            <div class="git-sync-message">{message()}</div>
          </Show>
        </div>
      </Portal>
    </Show>
  )
}
