/**
 * RefsPickerPanel — standalone branch/stash picker Portal.
 *
 * Always mounted in App. Opens/closes independently of whether the git panel
 * is open. Exposes a `registerToggle` prop so App can wire TopBar's branch
 * chip click directly to this component regardless of git panel state.
 */
import { createMemo, createSignal, For, onMount, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import type { GitBranchRef, GitRefsResult } from '../../lib/ipc'

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
            </div>
          </Show>
          <Show when={!loading() && tab() === 'stash'}>
            <div class="git-refs-list">
              <Show when={visibleStashes().length === 0}>
                <div class="git-refs-empty">No stashes found</div>
              </Show>
              <For each={visibleStashes()}>
                {(stash) => (
                  <div class="git-stash-row">
                    <span>{`stash@{${stash.index}}`}</span>
                    <span>{stash.message}</span>
                  </div>
                )}
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
