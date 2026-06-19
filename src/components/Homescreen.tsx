/**
 * Homescreen — OpenCode desktop v2 style: two-column layout.
 * Left: Projects (workspaces) + Settings/Help. Right: Search + Grouped sessions.
 */
import fuzzysort from 'fuzzysort'
import { FolderOpen, Search } from 'lucide-solid'
import { createMemo, createSignal, For, Show } from 'solid-js'
import type { SessionListItem, WorkspaceInfo } from '../lib/ipc'
import { formatRelativeTime, groupSessions } from '../lib/sessionView'
import { isMacPlatform } from '../lib/shortcutFormat'
import { UsageCard } from './usage/UsageCard'

interface Props {
  sessions: SessionListItem[]
  workspaces: WorkspaceInfo[]
  selectedWorkspacePath: string | null
  activeSessionPath: string | null
  onSelectSession: (path: string) => void
  onNewSession: () => void
  onOpenWorkspace: () => void
  onSelectWorkspace: (path: string) => void
  onClose: () => void
}

export function Homescreen(props: Props) {
  const [query, setQuery] = createSignal('')

  const filtered = createMemo(() => {
    const q = query().trim()
    if (!q) return props.sessions
    return fuzzysort
      .go(q, props.sessions, { keys: ['title', 'cwd'], threshold: -10000 })
      .map((r) => r.obj)
  })

  const grouped = createMemo(() => groupSessions(filtered(), 'time'))
  const usageWorkspaceLabel = createMemo(() => {
    const path = props.selectedWorkspacePath
    if (!path) return 'All projects'
    const name = props.workspaces.find((w) => w.path === path)?.displayName?.trim()
    if (name) return name
    const parts = path.replace(/\/$/, '').split('/')
    return parts[parts.length - 1] || path
  })

  const usageRefreshKey = createMemo(() => ({
    workspacePath: props.selectedWorkspacePath ?? undefined,
    revision: props.sessions
      .map(
        (session) =>
          `${session.path}:${session.updatedAt}:${session.inputTokens}:${session.outputTokens}:${session.cacheReadTokens}:${session.cacheWriteTokens}:${session.cost}`
      )
      .join('|'),
  }))

  return (
    <div class="homescreen">
      <div class="homescreen-shell">
        <UsageCard
          workspacePath={props.selectedWorkspacePath}
          workspaceLabel={usageWorkspaceLabel()}
          refreshRevision={usageRefreshKey().revision}
        />

        <div class="homescreen-main">
          {/* ── Left column: Projects ── */}
          <div class="homescreen-left">
            <div class="homescreen-left-header">
              <span class="homescreen-left-heading">Projects</span>
              <button
                type="button"
                class="homescreen-left-add"
                title="Open workspace"
                onClick={props.onOpenWorkspace}
              >
                <FolderOpen size={14} />
              </button>
            </div>

            <div class="homescreen-projects">
              <For
                each={props.workspaces}
                fallback={<div class="homescreen-empty-text">No projects</div>}
              >
                {(workspace) => {
                  const isSelected = workspace.path === props.selectedWorkspacePath
                  return (
                    <button
                      type="button"
                      class={`homescreen-project${isSelected ? ' is-selected' : ''}`}
                      onClick={() => props.onSelectWorkspace(workspace.path)}
                      title={workspace.path}
                    >
                      <span class="homescreen-project-name">{workspace.displayName}</span>
                    </button>
                  )
                }}
              </For>
            </div>
          </div>

          {/* ── Right column: Recent sessions ── */}
          <div class="homescreen-right">
            <div class="homescreen-search">
              <Search size={15} class="homescreen-search-icon" />

              <input
                class="homescreen-search-input"
                placeholder="Search sessions"
                value={query()}
                onInput={(e) => setQuery(e.currentTarget.value)}
                autofocus
              />
            </div>

            <div class="homescreen-right-header">
              <span />
              <button
                type="button"
                class="homescreen-new-session"
                onClick={props.onNewSession}
                title={`New session (${isMacPlatform() ? '⌘N' : 'Ctrl+N'})`}
              >
                <svg
                  aria-hidden="true"
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                </svg>
                New session
              </button>
            </div>

            <div class="homescreen-sessions">
              <Show
                when={filtered().length > 0}
                fallback={
                  <div class="homescreen-empty">
                    {query().trim()
                      ? `No sessions matching "${query()}"`
                      : 'No sessions yet. Start a prompt to create the first thread.'}
                  </div>
                }
              >
                <For each={grouped()}>
                  {(group) => (
                    <section class="homescreen-group">
                      <div class="homescreen-group-label">{group.label}</div>
                      <For each={group.sessions}>
                        {(session) => {
                          const isActive = session.path === props.activeSessionPath
                          const _wsName = session.cwd.split('/').pop() ?? ''
                          return (
                            <button
                              type="button"
                              class={`homescreen-session${isActive ? ' is-active' : ''}`}
                              onClick={() => {
                                if (!isActive) props.onSelectSession(session.path)
                                props.onClose()
                              }}
                            >
                              <span class="homescreen-session-title">
                                {session.title || 'Untitled session'}
                              </span>
                              <span class="homescreen-session-meta">
                                {formatRelativeTime(session.updatedAt)}
                              </span>
                            </button>
                          )
                        }}
                      </For>
                    </section>
                  )}
                </For>
              </Show>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
