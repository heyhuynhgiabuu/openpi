/**
 * SessionMap — read-only view of the session tree Pi stores in the JSONL file.
 *
 * Pi sessions are trees (parentId branching, compaction entries, labels), not
 * flat chats. This overlay renders every root-to-leaf branch, marks the active
 * leaf, lists fork points, and filters entries by text. Data comes from main via
 * GET_SESSION_TREE — the renderer never parses JSONL or imports the Pi SDK.
 */
import { Search, X } from 'lucide-solid'
import {
  type Component,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js'
import type { TreeEntryNode } from '../../lib/ipc'
import {
  BranchCard,
  countLabel,
  isNavigable,
  nodeDetail,
  nodeLabel,
  type VisibleBranch,
} from './BranchCard'

export interface SessionMapProps {
  sessionPath: string
  /**
   * Leaf the session is on when it is not the file's last entry (a branch
   * switch moves Pi's leaf without writing an entry).
   */
  leafId: string | null
  /** Increments when Pi writes an entry; the tree reloads on change. */
  treeVersion: number
  onClose: () => void
  /** True when the conversation has this entry loaded, so jumping to it will land somewhere. */
  isEntryLoaded: (entryId: string) => boolean
  onNavigate: (entryId: string) => void
  /** Continue the session from this entry; rejects with the reason it could not. */
  onBranchFrom: (entryId: string) => Promise<void>
}

export const SessionMap: Component<SessionMapProps> = (props) => {
  const [tree, { refetch: refetchTree }] = createResource(
    () => props.sessionPath,
    (sessionPath) => window.openpi.getSessionTree(sessionPath, props.leafId ?? undefined)
  )
  // Reading the resource accessor re-throws its error, so the error state is
  // read first and the rest of the component only ever sees loaded data.
  const data = () => (tree.error ? null : (tree() ?? null))
  const [query, setQuery] = createSignal('')
  const [cursor, setCursor] = createSignal(0)
  const [cursorMoved, setCursorMoved] = createSignal(false)
  const [notice, setNotice] = createSignal<string | null>(null)
  // Entry the user asked to continue from, held until they confirm: moving the
  // leaf changes where the next message lands, so it is never a single click.
  const [pendingBranch, setPendingBranch] = createSignal<TreeEntryNode | null>(null)
  const [isBranching, setIsBranching] = createSignal(false)
  let listRef: HTMLDivElement | undefined
  let searchRef: HTMLInputElement | undefined

  const matches = (node: TreeEntryNode) => {
    const needle = query().trim().toLowerCase()
    if (!needle) return true
    return `${nodeLabel(node)} ${nodeDetail(node)}`.toLowerCase().includes(needle)
  }

  // Branches keep their original number so "Branch 2" stays Branch 2 while a
  // filter hides the branches that have no match. Each visible branch carries
  // the offset of its first node, because the cursor addresses nodes by their
  // position in the flat list of visible nodes.
  const branches = createMemo<VisibleBranch[]>(() => {
    const visible: VisibleBranch[] = []
    let offset = 0
    for (const [index, branch] of (data()?.branches ?? []).entries()) {
      const nodes = branch.nodes.filter(matches)
      if (nodes.length === 0) continue
      visible.push({ leafId: branch.leafId, position: index + 1, offset, nodes })
      offset += nodes.length
    }
    return visible
  })
  const nodes = createMemo(() => branches().flatMap((branch) => branch.nodes))
  const entryCount = () =>
    (data()?.branches ?? []).reduce((sum, branch) => sum + branch.nodes.length, 0)

  // The session map is a live view: Pi keeps writing entries while it is open.
  createEffect(
    on(
      () => props.treeVersion,
      () => void refetchTree(),
      { defer: true }
    )
  )

  // The cursor sits on the leaf the session is at, or on the first match when a
  // filter hides it. It stops following once the user moves it, so a live reload
  // (Pi writing entries) never yanks the cursor off the entry they are on.
  const placeCursor = () => {
    const index = nodes().findIndex((node) => node.id === data()?.activeLeafId)
    setCursor(index >= 0 ? index : 0)
  }

  createEffect(
    on(
      query,
      () => {
        setCursorMoved(false)
        placeCursor()
      },
      { defer: true }
    )
  )

  createEffect(() => {
    if (!data() || cursorMoved()) return
    placeCursor()
  })

  createEffect(() => {
    const index = cursor()
    listRef?.querySelector(`[data-map-idx="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  })

  const activate = (node: TreeEntryNode) => {
    if (!isNavigable(node)) {
      setNotice('This entry has no message in the conversation.')
      return
    }
    if (!props.isEntryLoaded(node.id)) {
      setNotice(
        'Not loaded in the conversation yet — scroll back in the chat to load older history.'
      )
      return
    }
    props.onNavigate(node.id)
    props.onClose()
  }

  const startBranch = (node: TreeEntryNode) => {
    setNotice(null)
    setPendingBranch(node)
  }

  const confirmBranch = async () => {
    const node = pendingBranch()
    if (!node || isBranching()) return
    setIsBranching(true)
    try {
      await props.onBranchFrom(node.id)
      props.onClose()
    } catch (error) {
      setPendingBranch(null)
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setIsBranching(false)
    }
  }

  const moveCursor = (next: number) => {
    const total = nodes().length
    if (total === 0) return
    setCursorMoved(true)
    setCursor(Math.max(0, Math.min(next, total - 1)))
    setNotice(null)
  }

  onMount(() => {
    searchRef?.focus()
    // Capture phase: the overlay owns these keys while it is open, including
    // when focus sits outside it (the composer keeps focus when the map opens).
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        // Escape unwinds one step at a time: pending branch, then filter, then close.
        if (pendingBranch()) setPendingBranch(null)
        else if (query().trim()) setQuery('')
        else props.onClose()
        return
      }
      const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
      if (step !== 0) {
        event.preventDefault()
        moveCursor(cursor() + step)
        return
      }
      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault()
        moveCursor(event.key === 'Home' ? 0 : nodes().length - 1)
        return
      }
      if (event.key === 'Enter') {
        // Shift+Enter asks to continue from the entry; plain Enter jumps to it.
        if (event.shiftKey) {
          const node = nodes()[cursor()]
          if (!node) return
          event.preventDefault()
          startBranch(node)
          return
        }
        if (pendingBranch()) {
          event.preventDefault()
          void confirmBranch()
          return
        }
        const node = nodes()[cursor()]
        if (!node) return
        event.preventDefault()
        activate(node)
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    onCleanup(() => document.removeEventListener('keydown', onKeyDown, true))
  })

  return (
    <div
      class="session-map"
      role="dialog"
      aria-modal="true"
      aria-label="Session map"
      onMouseDown={(event) => {
        // mousedown, not click: releasing a text selection outside the panel
        // must not close the map.
        if (event.currentTarget === event.target) props.onClose()
      }}
    >
      <div class="session-map-shell">
        <header class="session-map-header">
          <div>
            <h2 class="session-map-title">Session map</h2>
            <p class="session-map-meta">
              {countLabel(data()?.branches.length ?? 0, 'branch', 'branches')} ·{' '}
              {countLabel(data()?.forkPoints.length ?? 0, 'fork', 'forks')}
              <Show when={query().trim()}>
                {' · '}
                {countLabel(nodes().length, 'match', 'matches')} of{' '}
                {countLabel(entryCount(), 'entry', 'entries')}
              </Show>
            </p>
            <Show when={notice()}>
              <p class="session-map-notice">{notice()}</p>
            </Show>
          </div>
          <button
            type="button"
            class="session-map-close"
            aria-label="Close session map"
            onClick={() => props.onClose()}
          >
            <X size={14} />
          </button>
        </header>

        <Show when={tree.loading}>
          <div class="session-map-empty">Loading session tree…</div>
        </Show>
        <Show when={tree.error}>
          <div class="session-map-empty">Could not load the session tree.</div>
        </Show>
        <Show when={data()}>
          {(payload) => (
            <Show
              when={entryCount() > 0}
              fallback={<div class="session-map-empty">This session has no entries yet.</div>}
            >
              <div class="session-map-search-row">
                <Search size={13} class="session-map-search-icon" />
                <input
                  ref={searchRef}
                  type="text"
                  class="session-map-search-input"
                  aria-label="Filter session entries"
                  placeholder="Filter entries by text…"
                  value={query()}
                  onInput={(event) => setQuery(event.currentTarget.value)}
                />
              </div>
              <Show when={pendingBranch()}>
                {(node) => (
                  <div class="session-map-confirm">
                    <span>
                      Continue from this {nodeLabel(node()).toLowerCase()} entry? The next message
                      becomes its child and the session keeps its history.
                    </span>
                    <div class="session-map-confirm-actions">
                      <button
                        type="button"
                        class="session-map-confirm-primary"
                        disabled={isBranching()}
                        onClick={() => void confirmBranch()}
                      >
                        {isBranching() ? 'Branching…' : 'Branch here'}
                      </button>
                      <button
                        type="button"
                        disabled={isBranching()}
                        onClick={() => setPendingBranch(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </Show>
              <Show
                when={nodes().length > 0}
                fallback={<div class="session-map-empty">No entries match “{query().trim()}”.</div>}
              >
                <div class="session-map-branches" ref={listRef}>
                  <For each={branches()}>
                    {(branch) => (
                      <BranchCard
                        branch={branch}
                        activeLeafId={payload().activeLeafId}
                        cursor={cursor()}
                        onFocusNode={moveCursor}
                        onActivateNode={activate}
                        onStartBranch={startBranch}
                      />
                    )}
                  </For>
                </div>
              </Show>
            </Show>
          )}
        </Show>
      </div>
    </div>
  )
}
