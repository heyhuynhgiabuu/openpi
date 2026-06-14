import fuzzysort from 'fuzzysort'
import { Archive, Check, Plus, RotateCcw, Search, Trash2 } from 'lucide-solid'
import { createMemo, createSignal, For, Show } from 'solid-js'
import type { ArchivedSessionItem, SessionListItem, WorkspaceInfo } from '../../lib/ipc'
import { formatRelativeTime, groupSessions } from '../../lib/sessionView'
import { isMacPlatform } from '../../lib/shortcutFormat'
import type { GroupMode, SortMode } from '../../types/session'
import { SessionFilterMenu } from './SessionFilterMenu'
import { SessionRow } from './SessionRow'

const PAGE_SIZE_INITIAL = 10
const PAGE_SIZE_MORE = 5

type SessionSidebarProps = {
  style?: string | Record<string, string>
  sessions: SessionListItem[]
  workspaces: WorkspaceInfo[]
  selectedWorkspacePath?: string | null
  activePath?: string | null
  query: string
  sortBy: SortMode
  groupBy: GroupMode
  showRecent: boolean
  collapsedGroups: Set<string>
  pinnedSessions: Set<string>
  showArchived: boolean
  archivedSessions: ArchivedSessionItem[]
  onQuery: (value: string) => void
  onSort: (value: SortMode) => void
  onGroup: (value: GroupMode) => void
  onShowRecent: (value: boolean) => void
  onCollapseAll: () => void
  onToggleGroup: (group: string) => void
  onNewSession: () => void
  onNewSessionIn: (workspacePath: string) => void
  onArchiveGroup: (label: string, paths: string[]) => void
  onArchiveSession: (path: string) => void
  onPinSession: (path: string) => void
  onToggleArchived: () => void
  onUnarchiveSession: (archivedPath: string) => void
  onDeleteArchivedSession: (archivedPath: string) => void
  onOpenSession: (session: SessionListItem) => void
}

export function SessionSidebar(props: SessionSidebarProps) {
  const [searchVisible, setSearchVisible] = createSignal(Boolean(props.query))

  // ─ Update state ───────────────────────────────────────────────────
  // Per-group visible count — only applied when not searching.
  // Map key is the group key string.
  const [visibleCounts, setVisibleCounts] = createSignal<Map<string, number>>(new Map())

  const getVisible = (key: string) => visibleCounts().get(key) ?? PAGE_SIZE_INITIAL
  const loadMore = (key: string, total: number) => {
    setVisibleCounts((prev) => {
      const next = new Map(prev)
      next.set(key, Math.min((next.get(key) ?? PAGE_SIZE_INITIAL) + PAGE_SIZE_MORE, total))
      return next
    })
  }

  const pinnedItems = createMemo(() =>
    props.sessions.filter((session) => props.pinnedSessions.has(session.path))
  )

  const filtered = createMemo(() => {
    const q = props.query
    const sess = props.sessions.filter((session) => !props.pinnedSessions.has(session.path))
    if (!q.trim()) return sess
    return fuzzysort
      .go(q, sess, { keys: ['title', 'cwd'], threshold: -10000 })
      .map((result) => result.obj)
  })

  const grouped = createMemo(() => groupSessions(filtered(), props.groupBy))

  return (
    <aside class="session-sidebar" style={props.style}>
      <div class="sidebar-header">
        <div class="sidebar-title-row">
          <div class="eyebrow">Threads</div>
          <div class="sidebar-actions">
            <button
              type="button"
              class="icon-button"
              onClick={() => setSearchVisible((value) => !value)}
              aria-label="Search threads"
            >
              <Search size={15} />
            </button>
            <SessionFilterMenu
              sortBy={props.sortBy}
              groupBy={props.groupBy}
              showRecent={props.showRecent}
              onSort={props.onSort}
              onGroup={props.onGroup}
              onShowRecent={props.onShowRecent}
              onCollapseAll={props.onCollapseAll}
            />
            <button
              type="button"
              class={`icon-button${props.showArchived ? ' is-active' : ''}`}
              onClick={props.onToggleArchived}
              title={`Archived threads${props.archivedSessions.length > 0 ? ` (${props.archivedSessions.length})` : ''}`}
              aria-label="Archived threads"
            >
              <Archive size={15} />
            </button>
            <button
              type="button"
              class="icon-button no-drag"
              onClick={props.onNewSession}
              title={`New thread (${isMacPlatform() ? '⌘N' : 'Ctrl+N'})`}
              aria-label="New thread"
            >
              <Plus size={15} />
            </button>
          </div>
        </div>

        <Show when={searchVisible()}>
          <label class="search-field">
            <Search size={14} />
            <input
              value={props.query}
              onInput={(event) => props.onQuery(event.currentTarget.value)}
              placeholder="Search threads"
            />
          </label>
        </Show>
      </div>

      <div class="session-list">
        <Show when={props.showArchived}>
          <section class="archived-section">
            <div class="archived-section-head">
              <span>Archived</span>
              <span class="archived-section-count">{props.archivedSessions.length}</span>
            </div>
            <Show
              when={props.archivedSessions.length === 0}
              fallback={
                <For each={props.archivedSessions}>
                  {(item) => (
                    <div class="archived-row">
                      <div class="archived-row-info">
                        <span class="archived-row-workspace">{item.workspaceName}</span>
                        <span class="archived-row-date">
                          {formatRelativeTime(new Date(item.archivedAt).toISOString())}
                        </span>
                      </div>
                      <button
                        type="button"
                        class="archived-restore-btn"
                        title="Restore session"
                        onClick={() => props.onUnarchiveSession(item.archivedPath)}
                      >
                        <RotateCcw size={11} />
                      </button>
                      <button
                        type="button"
                        class="archived-delete-btn"
                        title="Permanently delete session"
                        onClick={() => props.onDeleteArchivedSession(item.archivedPath)}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  )}
                </For>
              }
            >
              <div class="archived-empty">No archived sessions</div>
            </Show>
          </section>
        </Show>

        <Show when={pinnedItems().length > 0}>
          <section class="session-group pinned-section">
            <div class="session-group-header">
              <span class="sg-label">Pinned</span>
            </div>
            <For each={pinnedItems()}>
              {(session) => (
                <SessionRow
                  session={session}
                  active={props.activePath === session.path || session.active}
                  isPinned={true}
                  onOpen={() => props.onOpenSession(session)}
                  onPin={() => props.onPinSession(session.path)}
                  onArchive={() => props.onArchiveSession(session.path)}
                />
              )}
            </For>
          </section>
        </Show>

        <Show when={grouped().length === 0 && pinnedItems().length === 0 && !props.showArchived}>
          <div class="sidebar-empty">
            No threads indexed yet. Start a prompt to create the first Pi thread.
          </div>
        </Show>

        <For each={grouped()}>
          {(group) => {
            const isWorkspaceGroup = group.key.startsWith('/')
            const sessionPaths = group.sessions.map((session) => session.path)

            // Per-group visible count — pagination disabled when searching
            const visibleCount = () =>
              props.query.trim() ? group.sessions.length : getVisible(group.key)

            const visibleSessions = () => group.sessions.slice(0, visibleCount())
            const hasMore = () => !props.query.trim() && group.sessions.length > visibleCount()
            const remaining = () => group.sessions.length - visibleCount()

            return (
              <section class="session-group">
                {/* Group label — non-collapsible; shown for time-based groups, archive actions for workspace groups */}
                <div class="session-group-header session-group-header--flat">
                  <span class="sg-label">{group.label}</span>
                  <Show when={isWorkspaceGroup}>
                    <div class="sg-actions">
                      <button
                        type="button"
                        class="sg-action-btn"
                        title="Archive all"
                        onClick={() => props.onArchiveGroup(group.label, sessionPaths)}
                      >
                        <Check size={12} />
                      </button>
                      <button
                        type="button"
                        class="sg-action-btn"
                        title="New session in this workspace"
                        onClick={() => props.onNewSessionIn(group.key)}
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                  </Show>
                  <span class="sg-count">{group.sessions.length}</span>
                </div>
                <For each={visibleSessions()}>
                  {(session) => (
                    <SessionRow
                      session={session}
                      active={props.activePath === session.path || session.active}
                      isPinned={props.pinnedSessions.has(session.path)}
                      onOpen={() => props.onOpenSession(session)}
                      onPin={() => props.onPinSession(session.path)}
                      onArchive={() => props.onArchiveSession(session.path)}
                    />
                  )}
                </For>
                <Show when={hasMore()}>
                  <button
                    type="button"
                    class="sg-load-more-btn"
                    onClick={() => loadMore(group.key, group.sessions.length)}
                  >
                    Load {Math.min(PAGE_SIZE_MORE, remaining())} more
                    <span class="sg-load-more-rem">{remaining()} remaining</span>
                  </button>
                </Show>
              </section>
            )
          }}
        </For>
      </div>
    </aside>
  )
}
