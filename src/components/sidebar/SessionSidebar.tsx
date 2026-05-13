import fuzzysort from 'fuzzysort'
import { Archive, ArrowUpCircle, Check, FileText, Plus, RotateCcw, Search } from 'lucide-solid'
import { createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import type {
  AppUpdateStatus,
  ArchivedSessionItem,
  SessionListItem,
  WorkspaceInfo,
} from '../../lib/ipc'
import { formatRelativeTime, groupSessions } from '../../lib/sessionView'
import type { GroupMode, SortMode } from '../../types/session'
import { ChangelogModal } from '../ChangelogModal'
import { SessionFilterMenu } from './SessionFilterMenu'
import { SessionRow } from './SessionRow'

const PAGE_SIZE_INITIAL = 10
const PAGE_SIZE_MORE = 5
const HOMEBREW_UPGRADE_COMMAND = 'brew update && brew upgrade --cask openpi'

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
  onOpenSession: (session: SessionListItem) => void
  appVersion?: string
}

export function SessionSidebar(props: SessionSidebarProps) {
  const [searchVisible, setSearchVisible] = createSignal(Boolean(props.query))

  // ─ Update state ───────────────────────────────────────────────────
  const [updateStatus, setUpdateStatus] = createSignal<AppUpdateStatus | null>(null)
  const [changelogOpen, setChangelogOpen] = createSignal(false)
  const [updateCommandCopied, setUpdateCommandCopied] = createSignal(false)

  onMount(() => {
    // Subscribe to update events pushed from main on cold start
    const unsub = window.openpi.appUpdate.onStatus((status) => setUpdateStatus(status))
    onCleanup(unsub)
  })

  const updateAvailable = () => updateStatus()?.state === 'available'

  const copyUpgradeCommand = async () => {
    try {
      await navigator.clipboard.writeText(HOMEBREW_UPGRADE_COMMAND)
      setUpdateCommandCopied(true)
      setTimeout(() => setUpdateCommandCopied(false), 2500)
    } catch {
      const url = updateStatus()?.releaseUrl
      if (url) void window.openpi.appUpdate.openRelease(url)
    }
  }

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
          <div class="eyebrow">Sessions</div>
          <div class="sidebar-actions">
            <button
              type="button"
              class="icon-button"
              onClick={() => setSearchVisible((value) => !value)}
              aria-label="Search sessions"
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
              title={`Archived sessions${props.archivedSessions.length > 0 ? ` (${props.archivedSessions.length})` : ''}`}
              aria-label="Archived sessions"
            >
              <Archive size={15} />
            </button>
            <button
              type="button"
              class="sidebar-new-btn no-drag"
              onClick={props.onNewSession}
              title="New session (⌘N)"
            >
              New <kbd class="sidebar-kbd">⌘N</kbd>
            </button>
          </div>
        </div>

        <Show when={searchVisible()}>
          <label class="search-field">
            <Search size={14} />
            <input
              value={props.query}
              onInput={(event) => props.onQuery(event.currentTarget.value)}
              placeholder="Search sessions"
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
            No sessions indexed yet. Start a prompt to create the first Pi session.
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

      {/* ── Sidebar footer: version + update chip + changelog ──────── */}
      <div class="sidebar-footer">
        <Show
          when={updateAvailable()}
          fallback={
            <button
              type="button"
              class="sidebar-footer-version"
              title="Check for updates"
              onClick={() => {
                void window.openpi.appUpdate.check().then(setUpdateStatus)
              }}
            >
              v{props.appVersion ?? '…'}
            </button>
          }
        >
          <button
            type="button"
            class="sidebar-footer-update-chip"
            title={`OpenPi ${updateStatus()?.latestVersion} is available — click to copy: ${HOMEBREW_UPGRADE_COMMAND}`}
            onClick={() => {
              void copyUpgradeCommand()
            }}
          >
            <ArrowUpCircle size={12} />
            {updateCommandCopied()
              ? 'Copied brew command'
              : (updateStatus()?.latestVersion ?? 'Update available')}
          </button>
        </Show>

        <button
          type="button"
          class="sidebar-footer-changelog-btn"
          title="What's new"
          onClick={() => setChangelogOpen(true)}
        >
          <FileText size={13} />
        </button>
      </div>

      <ChangelogModal open={changelogOpen()} onClose={() => setChangelogOpen(false)} />
    </aside>
  )
}
