/**
 * TopBar — SolidJS version.
 * Three-zone header: homescreen + new session · session tabs · workspace + git + settings.
 */
import { GitBranch, House, MonitorCog, Plus } from 'lucide-solid'
import { createEffect, createMemo, createSignal, For, Show } from 'solid-js'
import type { ModelInfo, SessionListItem } from '../lib/ipc'
import { isMacPlatform } from '../lib/shortcutFormat'

interface Props {
  workspaceName: string
  gitBranch: string | null
  gitStats?: { added: number; removed: number; untracked: number; changed?: number } | null
  gitUpstream?: string | null
  gitChangeCount?: number | null
  onBranchClick?: () => void
  sessionName: string
  isStreaming: boolean
  onRenameSession: (name: string) => void
  onOpenWorkspace: () => void
  onOpenSettings: () => void
  startRenameRef?: (fn: () => void) => void
  models?: ModelInfo[]
  currentModel?: ModelInfo | null
  onSelectModel?: (model: ModelInfo) => void
  // ── Session tabs ─────────────────────────────────────────────────
  sessions: SessionListItem[]
  activeSessionPath: string | null
  onSelectSession: (path: string) => void
  onNewSession: () => void
  onToggleHomescreen: () => void
}

export function TopBar(props: Props) {
  const [editing, setEditing] = createSignal(false)
  const [draft, setDraft] = createSignal('')
  let inputRef!: HTMLInputElement

  const startEdit = () => {
    setDraft(props.sessionName)
    setEditing(true)
    setTimeout(() => inputRef?.select(), 0)
  }

  props.startRenameRef?.(startEdit)

  const commitEdit = () => {
    const trimmed = draft().trim()
    if (trimmed && trimmed !== props.sessionName) props.onRenameSession(trimmed)
    setEditing(false)
  }

  const [openSessionPaths, setOpenSessionPaths] = createSignal<string[]>([])

  createEffect(() => {
    const activePath = props.activeSessionPath
    if (!activePath) return
    setOpenSessionPaths((paths) => (paths.includes(activePath) ? paths : [...paths, activePath]))
  })

  const sessionTabs = createMemo(() => {
    const knownPaths = new Set(props.sessions.map((session) => session.path))
    const activePath = props.activeSessionPath
    const paths = openSessionPaths().filter((path) => path === activePath || knownPaths.has(path))

    if (activePath && !paths.includes(activePath)) paths.push(activePath)

    return paths.map((path) => {
      const session = props.sessions.find((item) => item.path === path)
      return {
        path,
        title: session?.title || (path === activePath ? props.sessionName : 'session'),
      }
    })
  })

  const closeSessionTab = (path: string) => {
    const remainingPaths = sessionTabs()
      .map((session) => session.path)
      .filter((sessionPath) => sessionPath !== path)

    setOpenSessionPaths((paths) => paths.filter((sessionPath) => sessionPath !== path))

    if (path === props.activeSessionPath && remainingPaths.length > 0) {
      props.onSelectSession(remainingPaths[remainingPaths.length - 1])
    }
  }

  return (
    <header class="topbar drag">
      {/* ── Left zone: homescreen + new session ── */}
      <div class="topbar-left-zone">
        <div class="topbar-left-buttons">
          <button
            type="button"
            class="topbar-icon-btn no-drag"
            onClick={props.onToggleHomescreen}
            title="Show homescreen"
            aria-label="Show homescreen"
          >
            <House size={16} />
          </button>
          <button
            type="button"
            class="topbar-icon-btn no-drag"
            onClick={props.onNewSession}
            title={`New thread (${isMacPlatform() ? '⌘N' : 'Ctrl+N'})`}
            aria-label="New thread"
          >
            <Plus size={16} />
          </button>
        </div>
      </div>

      {/* ── Center zone: session tabs + workspace + git ── */}
      <div class="topbar-center no-drag">
        <div class="topbar-tabs">
          <Show
            when={!editing()}
            fallback={
              <input
                ref={(el) => {
                  inputRef = el
                }}
                class="topbar-name-input"
                value={draft()}
                onInput={(e) => setDraft(e.currentTarget.value)}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitEdit()
                  if (e.key === 'Escape') setEditing(false)
                }}
              />
            }
          >
            <For each={sessionTabs()}>
              {(session) => {
                const isActive = () => session.path === props.activeSessionPath
                return (
                  <div class={`topbar-tab${isActive() ? ' is-active' : ''}`}>
                    <button
                      type="button"
                      class="topbar-tab-main"
                      onClick={() => {
                        if (!isActive()) props.onSelectSession(session.path)
                      }}
                      onDblClick={() => {
                        if (isActive()) startEdit()
                      }}
                      title={isActive() ? 'Double-click to rename session' : 'Switch session'}
                    >
                      <span class="topbar-tab-label">{session.title}</span>
                    </button>
                    <button
                      type="button"
                      class="topbar-tab-close"
                      onClick={(event) => {
                        event.stopPropagation()
                        closeSessionTab(session.path)
                      }}
                      title="Close session tab"
                      aria-label="Close session tab"
                    >
                      ×
                    </button>
                  </div>
                )
              }}
            </For>
          </Show>
        </div>

        <span class="topbar-sep">in</span>

        <button
          type="button"
          class="topbar-workspace-btn no-drag"
          onClick={props.onOpenWorkspace}
          title="Change workspace"
        >
          {props.workspaceName}
        </button>

        <Show when={props.gitBranch}>
          {(getBranch) => (
            <>
              <button
                type="button"
                class="topbar-branch no-drag"
                onClick={props.onBranchClick}
                title={props.onBranchClick ? 'Switch branch' : undefined}
              >
                <GitBranch size={11} class="topbar-branch-icon" />
                {getBranch()}
                <Show
                  when={
                    props.gitStats &&
                    (props.gitStats.added > 0 ||
                      props.gitStats.removed > 0 ||
                      props.gitStats.untracked > 0)
                  }
                >
                  <span class="topbar-branch-stats">
                    <Show when={props.gitStats!.added > 0}>
                      <span class="topbar-stat-add">+{props.gitStats!.added}</span>
                    </Show>
                    <Show when={props.gitStats!.removed > 0}>
                      <span class="topbar-stat-rem">-{props.gitStats!.removed}</span>
                    </Show>
                    <Show when={props.gitStats!.untracked > 0}>
                      <span class="topbar-stat-unt">?{props.gitStats!.untracked}</span>
                    </Show>
                  </span>
                </Show>
              </button>
              <Show when={props.gitUpstream}>
                <span class="topbar-upstream-chip">{props.gitUpstream}</span>
              </Show>
              <Show when={props.gitChangeCount && props.gitChangeCount > 0}>
                <span class="topbar-change-count" title="Changed files">
                  {props.gitChangeCount}
                </span>
              </Show>
            </>
          )}
        </Show>

        <Show when={props.isStreaming}>
          <span class="pulse topbar-streaming-dot">·</span>
        </Show>
      </div>

      {/* ── Right zone: settings ── */}
      <div class="topbar-right-zone">
        <button
          type="button"
          class="topbar-icon-btn no-drag"
          onClick={props.onOpenSettings}
          title="Customize OpenPi"
          aria-label="Customize OpenPi"
        >
          <MonitorCog size={15} />
        </button>
      </div>
    </header>
  )
}
