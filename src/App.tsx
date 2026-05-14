/**
 * App.tsx — root shell, SolidJS version.
 *
 * React migration notes:
 *   - useState  → createSignal (accessed directly; signals are created once)
 *   - useEffect → onMount + createEffect
 *   - useCallback → plain async/sync functions (no deps, components don't re-execute)
 *   - Early return pattern → <Show when={session.ready}> control flow
 *   - className  → class in SolidJS JSX
 */
import { batch, createMemo, createSignal, onMount, Show } from 'solid-js'
import { CommandPalette, type PaletteCommand } from './components/CommandPalette'
import { Composer } from './components/Composer'
import { ConversationPane } from './components/conversation/ConversationPane'
import { CustomizationsModal } from './components/customizations/CustomizationsModal'
import { FileViewerModal } from './components/FileViewerModal'
import { DiffViewer } from './components/git/DiffViewer'
import { FileSearchModal } from './components/git/FileSearchModal'
import { GitPanel } from './components/git/GitPanel'
import { ConnectProviderModal } from './components/providers/ConnectProviderModal'
import { ManageModelsModal } from './components/providers/ManageModelsModal'
import { ResizeHandle } from './components/ResizeHandle'
import { ArchiveConfirmModal } from './components/sidebar/ArchiveConfirmModal'
import { SessionSidebar } from './components/sidebar/SessionSidebar'
import { WorkspaceRail } from './components/sidebar/WorkspaceRail'
import { TopBar } from './components/TopBar'
import { TerminalPanel } from './components/terminal/TerminalPanel'
import { Welcome } from './components/Welcome'
import { useOpenPiSession } from './hooks/useOpenPiSession'
import { applyAppearancePreferences, loadAppearancePreferences } from './lib/appearancePreferences'
import {
  DEFAULT_DISPLAY_PREFERENCES,
  DISPLAY_PREFERENCES_CHANGED_EVENT,
  type DisplayPreferences,
  loadDisplayPreferences,
} from './lib/displayPreferences'
import {
  type FileLineComment,
  formatFileLineCommentsPrompt,
  type NewFileLineComment,
} from './lib/fileLineComments'
import type { AppInfo, GitChangedFile, GitFileDiff, SkillItem } from './lib/ipc'
import {
  buildKeybindingEntries,
  eventMatchesBinding,
  findBinding,
  KEYBINDINGS_CHANGED_EVENT,
  type KeybindingActionId,
  type KeybindingOverrides,
  loadCustomKeybindings,
} from './lib/keybindings'
import { restoreThemeFromStorage } from './lib/themeApply'

/**
 * Strip YAML frontmatter from a SKILL.md file before sending to the LLM.
 * Matches Pi SDK's internal stripFrontmatter() used in _expandSkillCommand().
 * Frontmatter is metadata for the skill registry — the LLM only needs the body.
 */
function stripSkillFrontmatter(content: string): string {
  const trimmed = content.trimStart()
  if (!trimmed.startsWith('---')) return trimmed
  const afterOpen = trimmed.slice(3)
  const closeIdx = afterOpen.indexOf('\n---')
  if (closeIdx === -1) return trimmed
  return afterOpen.slice(closeIdx + 4).trimStart()
}

export default function App() {
  const session = useOpenPiSession()

  const [customizationsOpen, setCustomizationsOpen] = createSignal(false)
  const [terminalOpen, setTerminalOpen] = createSignal(false)
  const [newTerminalRequest, setNewTerminalRequest] = createSignal(0)
  const [sidebarOpen, setSidebarOpen] = createSignal(true)
  const [secondaryPanelOpen, setSecondaryPanelOpen] = createSignal(false)
  const [gitPanelTab, setGitPanelTab] = createSignal<'changes' | 'files' | 'history'>('changes')
  const [fileSearchOpen, setFileSearchOpen] = createSignal(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = createSignal(false)
  const [connectProviderOpen, setConnectProviderOpen] = createSignal(false)
  const [manageModelsOpen, setManageModelsOpen] = createSignal(false)
  const [showArchived, setShowArchived] = createSignal(false)
  const [archivedSessions, setArchivedSessions] = createSignal<
    import('./lib/ipc').ArchivedSessionItem[]
  >([])
  const [pinnedSessions, setPinnedSessions] = createSignal<Set<string>>(new Set())
  const [attachedFiles, setAttachedFiles] = createSignal<string[]>([])
  const [lineComments, setLineComments] = createSignal<FileLineComment[]>([])
  const [loadedSkills, setLoadedSkills] = createSignal<SkillItem[]>([])
  const [hiddenModels, setHiddenModels] = createSignal<Set<string>>(new Set())
  const [activeDiff, setActiveDiff] = createSignal<GitFileDiff | null>(null)
  const [fileViewer, setFileViewer] = createSignal<string | null>(null)
  const [diffFiles, setDiffFiles] = createSignal<GitChangedFile[]>([])
  const [diffIndex, setDiffIndex] = createSignal(0)
  const [archivePending, setArchivePending] = createSignal<{
    label: string
    paths: string[]
  } | null>(null)
  const [archiveSkipConfirm, setArchiveSkipConfirm] = createSignal(false)
  const [displayPreferences, setDisplayPreferences] = createSignal<DisplayPreferences>({
    ...DEFAULT_DISPLAY_PREFERENCES,
  })
  const [customKeybindings, setCustomKeybindings] = createSignal<KeybindingOverrides>({})
  const [appInfo, setAppInfo] = createSignal<AppInfo | null>(null)
  const appName = createMemo(() => appInfo()?.name ?? 'OpenPi')
  const appVersionLabel = createMemo(() => {
    const info = appInfo()
    if (!info) return null
    return `v${info.version}${info.releaseChannel ? ` · ${info.releaseChannel}` : ''}`
  })
  // Rename trigger — TopBar sets this when it mounts so App can call it from a keybinding
  let triggerRename: (() => void) | undefined

  // Resizable panel widths — persisted in prefs
  const SIDEBAR_DEFAULT = 280
  const GIT_PANEL_DEFAULT = 260
  const SIDEBAR_MIN = 240
  const SIDEBAR_MAX = 480
  const GIT_MIN = 200
  const GIT_MAX = 560

  const [sidebarWidth, setSidebarWidth] = createSignal(SIDEBAR_DEFAULT)
  const [gitPanelWidth, setGitPanelWidth] = createSignal(GIT_PANEL_DEFAULT)

  // Load persisted panel widths once
  onMount(() => {
    window.openpi
      .getPref('panel.sidebar_width')
      .then((v) => {
        const n = v ? parseInt(v, 10) : NaN
        if (!Number.isNaN(n)) setSidebarWidth(Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, n)))
      })
      .catch(() => {})
    window.openpi
      .getPref('panel.git_panel_width')
      .then((v) => {
        const n = v ? parseInt(v, 10) : NaN
        if (!Number.isNaN(n)) setGitPanelWidth(Math.max(GIT_MIN, Math.min(GIT_MAX, n)))
      })
      .catch(() => {})
  })

  const resizeSidebar = (delta: number) => {
    setSidebarWidth((prev) => {
      const next = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, prev + delta))
      void window.openpi.setPref('panel.sidebar_width', String(next))
      return next
    })
  }

  const resizeGitPanel = (delta: number) => {
    setGitPanelWidth((prev) => {
      const next = Math.max(GIT_MIN, Math.min(GIT_MAX, prev - delta)) // negative: panel grows to the left
      void window.openpi.setPref('panel.git_panel_width', String(next))
      return next
    })
  }

  onMount(() => {
    restoreThemeFromStorage()
    window.openpi
      .getAppInfo()
      .then(setAppInfo)
      .catch(() => {})
    loadAppearancePreferences()
      .then(applyAppearancePreferences)
      .catch(() => {})

    // Load persisted prefs
    window.openpi
      .getPref('pinned_sessions')
      .then((v) => {
        if (v) {
          try {
            setPinnedSessions(new Set(JSON.parse(v) as string[]))
          } catch {
            /* ignore */
          }
        }
      })
      .catch(() => {})

    window.openpi
      .getPref('hidden_models')
      .then((v) => {
        if (v) {
          try {
            setHiddenModels(new Set(JSON.parse(v) as string[]))
          } catch {
            /* ignore */
          }
        }
      })
      .catch(() => {})

    window.openpi
      .getPref('archive_skip_confirm')
      .then((v) => {
        if (v === 'true') setArchiveSkipConfirm(true)
      })
      .catch(() => {})

    loadDisplayPreferences()
      .then(setDisplayPreferences)
      .catch(() => {})
    loadCustomKeybindings()
      .then(setCustomKeybindings)
      .catch(() => {})

    const onDisplayPreferencesChanged = (event: Event) => {
      setDisplayPreferences((event as CustomEvent<DisplayPreferences>).detail)
    }
    window.addEventListener(DISPLAY_PREFERENCES_CHANGED_EVENT, onDisplayPreferencesChanged)

    const onKeybindingsChanged = (event: Event) => {
      setCustomKeybindings((event as CustomEvent<KeybindingOverrides>).detail)
    }
    window.addEventListener(KEYBINDINGS_CHANGED_EVENT, onKeybindingsChanged)

    const onKeyDown = (event: KeyboardEvent) => {
      const activeBindings = buildKeybindingEntries(customKeybindings())
      const binding = (actionId: KeybindingActionId) => findBinding(activeBindings, actionId)
      const target = event.target as HTMLElement | null
      const inDialog = Boolean(target?.closest('[role="dialog"], .customizations-modal'))
      const inTextInput = Boolean(
        target?.closest('input, textarea, select, [contenteditable="true"]')
      )
      const allowFromInput = event.metaKey || event.ctrlKey || event.altKey

      if (eventMatchesBinding(event, binding('openCommandPalette'))) {
        event.preventDefault()
        setCommandPaletteOpen(true)
        return
      }
      if (inDialog) return
      if (inTextInput && !allowFromInput && !eventMatchesBinding(event, binding('interruptAgent')))
        return

      if (eventMatchesBinding(event, binding('interruptAgent')) && session.isStreaming) {
        event.preventDefault()
        void window.openpi.abort()
        return
      }
      if (eventMatchesBinding(event, binding('newSession'))) {
        event.preventDefault()
        void session.createNewSession()
        return
      }
      if (eventMatchesBinding(event, binding('toggleTerminal'))) {
        event.preventDefault()
        setTerminalOpen((prev) => !prev)
        return
      }
      if (eventMatchesBinding(event, binding('newTerminal'))) {
        event.preventDefault()
        setTerminalOpen(true)
        setNewTerminalRequest((prev) => prev + 1)
        return
      }
      if (eventMatchesBinding(event, binding('toggleSidebar'))) {
        event.preventDefault()
        setSidebarOpen((prev) => !prev)
        return
      }
      if (eventMatchesBinding(event, binding('toggleGitPanel'))) {
        event.preventDefault()
        setSecondaryPanelOpen((prev) => !prev)
        return
      }
      if (eventMatchesBinding(event, binding('toggleFileTree'))) {
        event.preventDefault()
        if (secondaryPanelOpen() && gitPanelTab() === 'files') {
          setSecondaryPanelOpen(false)
        } else {
          setGitPanelTab('files')
          setSecondaryPanelOpen(true)
        }
        return
      }
      if (eventMatchesBinding(event, binding('openFileSearch'))) {
        event.preventDefault()
        setGitPanelTab('files')
        setSecondaryPanelOpen(true)
        setFileSearchOpen(true)
        return
      }
      if (eventMatchesBinding(event, binding('openCustomizations'))) {
        event.preventDefault()
        setCustomizationsOpen(true)
        return
      }
      if (eventMatchesBinding(event, binding('openProject'))) {
        event.preventDefault()
        void session.openWorkspace()
        return
      }
      if (eventMatchesBinding(event, binding('renameSession'))) {
        event.preventDefault()
        triggerRename?.()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener(DISPLAY_PREFERENCES_CHANGED_EVENT, onDisplayPreferencesChanged)
      window.removeEventListener(KEYBINDINGS_CHANGED_EVENT, onKeybindingsChanged)
    }
  })

  // ── Archive / pin helpers ─────────────────────────────────────────────────

  const loadArchivedSessions = async () => {
    const items = await window.openpi.listArchivedSessions()
    setArchivedSessions(items)
  }

  const handleToggleArchived = () => {
    const next = !showArchived()
    setShowArchived(next)
    if (next) {
      void loadArchivedSessions()
    }
  }

  const handleUnarchiveSession = async (archivedPath: string) => {
    await window.openpi.unarchiveSessions([archivedPath])
    void loadArchivedSessions()
  }

  const togglePinSession = (path: string) => {
    setPinnedSessions((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      void window.openpi.setPref('pinned_sessions', JSON.stringify([...next]))
      return next
    })
  }

  const handleArchiveSession = async (path: string) => {
    if (pinnedSessions().has(path)) {
      setPinnedSessions((prev) => {
        const next = new Set(prev)
        next.delete(path)
        void window.openpi.setPref('pinned_sessions', JSON.stringify([...next]))
        return next
      })
    }
    await window.openpi.archiveSessions([path])
  }

  const handleArchiveGroup = (label: string, paths: string[]) => {
    if (archiveSkipConfirm()) {
      void window.openpi.archiveSessions(paths)
      return
    }
    setArchivePending({ label, paths })
  }

  const handleArchiveConfirm = async (skipNext: boolean) => {
    const pending = archivePending()
    if (!pending) return
    if (skipNext) {
      setArchiveSkipConfirm(true)
      void window.openpi.setPref('archive_skip_confirm', 'true')
    }
    await window.openpi.archiveSessions(pending.paths)
    setArchivePending(null)
  }

  const handleNewSessionIn = (workspacePath: string) => {
    void window.openpi.newSession(workspacePath)
  }

  // ── File / skill attachment ───────────────────────────────────────────────

  const addAttachedFile = (relPath: string) => {
    setAttachedFiles((prev) => (prev.includes(relPath) ? prev : [...prev, relPath]))
  }

  const removeAttachedFile = (relPath: string) => {
    setAttachedFiles((prev) => prev.filter((p) => p !== relPath))
  }

  const addLineComment = (comment: NewFileLineComment) => {
    const id =
      globalThis.crypto?.randomUUID?.() ?? `${comment.path}:${comment.startLine}-${Date.now()}`
    setLineComments((prev) => [...prev, { ...comment, id }])
  }

  const removeLineComment = (id: string) => {
    setLineComments((prev) => prev.filter((comment) => comment.id !== id))
  }

  const addLoadedSkill = (skill: SkillItem) => {
    setLoadedSkills((prev) => (prev.some((s) => s.name === skill.name) ? prev : [...prev, skill]))
  }

  const removeLoadedSkill = (name: string) => {
    setLoadedSkills((prev) => prev.filter((s) => s.name !== name))
  }

  const handleSend = async () => {
    const hasContext =
      loadedSkills().length > 0 || attachedFiles().length > 0 || lineComments().length > 0
    if (!session.input.trim() && !hasContext) return

    let prefix = ''

    const skills = loadedSkills()
    if (skills.length > 0) {
      const skillReads = await Promise.all(
        skills.map((s) => window.openpi.readSkillFile(`${s.path}/SKILL.md`).catch(() => null))
      )
      // Build skill blocks matching Pi SDK's _expandSkillCommand() format exactly:
      //   <skill name="..." location=".../SKILL.md">\nReferences are relative to ...\n\n{body}\n</skill>
      // This ensures the LLM can resolve relative paths (./scripts/...) in skill content.
      // Frontmatter is stripped — it is registry metadata, not instructions.
      const skillBlocks = skillReads
        .map((content, i) => {
          if (!content) return null
          const skill = skills[i]
          const body = stripSkillFrontmatter(content)
          return `<skill name="${skill.name}" location="${skill.path}/SKILL.md">\nReferences are relative to ${skill.path}.\n\n${body}\n</skill>`
        })
        .filter(Boolean) as string[]
      if (skillBlocks.length > 0) {
        prefix = skillBlocks.join('\n\n')
      }
      setLoadedSkills([])
    }

    const files = attachedFiles()
    if (files.length > 0) {
      const reads = await Promise.all(files.map((p) => window.openpi.readFile(p).catch(() => null)))
      const blocks = reads
        .map((content, i) =>
          content ? `<file path="${files[i]}">\n${content.content}\n</file>` : null
        )
        .filter(Boolean) as string[]
      const filePrefix = blocks.join('\n\n')
      prefix = prefix ? `${prefix}\n\n${filePrefix}` : filePrefix
      setAttachedFiles([])
    }

    const comments = lineComments()
    if (comments.length > 0) {
      const commentsPrefix = formatFileLineCommentsPrompt(comments)
      prefix = prefix ? `${prefix}\n\n${commentsPrefix}` : commentsPrefix
      setLineComments([])
    }

    void session.send(prefix || undefined)
  }

  const toggleHiddenModel = (key: string) => {
    setHiddenModels((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      void window.openpi.setPref('hidden_models', JSON.stringify([...next]))
      return next
    })
  }

  const paletteCommands = createMemo<PaletteCommand[]>(() => {
    const entries = new Map(
      buildKeybindingEntries(customKeybindings()).map((entry) => [entry.id, entry])
    )
    const command = (id: KeybindingActionId, run: () => void): PaletteCommand | null => {
      const entry = entries.get(id)
      if (!entry) return null
      return {
        id,
        label: entry.label,
        description: entry.description,
        keys: entry.keys,
        run,
      }
    }

    return [
      command('newSession', () => void session.createNewSession()),
      command('openFileSearch', () => {
        setGitPanelTab('files')
        setSecondaryPanelOpen(true)
        setFileSearchOpen(true)
      }),
      command('openCustomizations', () => setCustomizationsOpen(true)),
      command('openProject', () => void session.openWorkspace()),
      command('renameSession', () => triggerRename?.()),
      command('toggleSidebar', () => setSidebarOpen((prev) => !prev)),
      command('toggleGitPanel', () => setSecondaryPanelOpen((prev) => !prev)),
      command('toggleFileTree', () => {
        if (secondaryPanelOpen() && gitPanelTab() === 'files') {
          setSecondaryPanelOpen(false)
        } else {
          setGitPanelTab('files')
          setSecondaryPanelOpen(true)
        }
      }),
      command('toggleTerminal', () => setTerminalOpen((prev) => !prev)),
      command('newTerminal', () => {
        setTerminalOpen(true)
        setNewTerminalRequest((prev) => prev + 1)
      }),
    ].filter((item): item is PaletteCommand => item != null)
  })

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Show
      when={session.ready}
      fallback={
        <Welcome
          appName={appName()}
          appVersionLabel={appVersionLabel()}
          onOpen={session.openWorkspace}
          error={session.error}
        />
      }
    >
      {(getReady) => {
        // getReady() is called once — NOT reactive on its own. Wrap every derived
        // value in createMemo so they recompute when session.ready changes (e.g.
        // after picking a new workspace or resuming a different session).
        const cwd = createMemo(() => getReady().cwd)
        const workspaceName = createMemo(() => cwd().split('/').pop() ?? cwd())
        const activeSessionPath = createMemo(() => getReady().sessionFile)
        const displayName = createMemo(
          () =>
            session.sessionName ??
            (activeSessionPath()
              ? (activeSessionPath()!.split('/').pop()?.replace('.jsonl', '') ?? 'session')
              : 'new session')
        )

        const visibleModels = () =>
          session.models.filter((m) => !hiddenModels().has(`${m.provider}/${m.id}`))

        return (
          <div class="app-shell">
            <TopBar
              sidebarOpen={sidebarOpen()}
              onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
              workspaceName={workspaceName()}
              gitBranch={session.gitBranch}
              gitStats={session.gitStats}
              sessionName={displayName()}
              isStreaming={session.isStreaming}
              onRenameSession={session.setSessionName}
              onOpenWorkspace={session.openWorkspace}
              models={session.models}
              currentModel={session.currentModel}
              onSelectModel={session.selectModel}
              terminalOpen={terminalOpen()}
              onToggleTerminal={() => setTerminalOpen((prev) => !prev)}
              secondaryPanelOpen={secondaryPanelOpen()}
              onToggleSecondaryPanel={() => setSecondaryPanelOpen((prev) => !prev)}
              onOpenSettings={() => setCustomizationsOpen(true)}
              startRenameRef={(fn) => {
                triggerRename = fn
              }}
            />

            <div class="workbench">
              <Show when={sidebarOpen()}>
                <WorkspaceRail
                  workspaces={session.workspaces}
                  selectedPath={session.selectedWorkspacePath}
                  activePath={cwd()}
                  onSelectWorkspace={(workspacePath) => {
                    void session.selectWorkspace(workspacePath)
                  }}
                  onOpenWorkspace={session.openWorkspace}
                  onNewSessionIn={handleNewSessionIn}
                  onOpenSession={session.openExistingSession}
                  onPreviewSessions={session.loadWorkspacePreview}
                />
                <SessionSidebar
                  style={{ width: `${sidebarWidth()}px` }}
                  sessions={session.sessions}
                  workspaces={session.workspaces}
                  selectedWorkspacePath={session.selectedWorkspacePath}
                  activePath={activeSessionPath()}
                  query={session.sessionQuery}
                  sortBy={session.sortBy}
                  groupBy={session.groupBy}
                  showRecent={session.showRecent}
                  collapsedGroups={session.collapsedGroups}
                  onQuery={session.setSessionQuery}
                  onSort={session.setSortBy}
                  onGroup={session.setGroupBy}
                  onShowRecent={session.setShowRecent}
                  onCollapseAll={session.collapseAllGroups}
                  onToggleGroup={session.toggleGroup}
                  onNewSession={session.createNewSession}
                  onNewSessionIn={handleNewSessionIn}
                  onArchiveGroup={handleArchiveGroup}
                  onArchiveSession={(path) => {
                    void handleArchiveSession(path)
                  }}
                  onPinSession={togglePinSession}
                  pinnedSessions={pinnedSessions()}
                  showArchived={showArchived()}
                  archivedSessions={archivedSessions()}
                  onToggleArchived={handleToggleArchived}
                  onUnarchiveSession={(p) => {
                    void handleUnarchiveSession(p)
                  }}
                  onOpenSession={session.openExistingSession}
                  appVersion={appInfo()?.version}
                />
                <ResizeHandle direction="horizontal" onResize={resizeSidebar} />
              </Show>

              <div class="center-col">
                <main class="main-panel">
                  <ConversationPane
                    messages={session.messages}
                    workspaceName={workspaceName()}
                    workspaceSummary={session.workspaceSummary}
                    activeSessionPath={activeSessionPath()}
                    setBottomRef={session.setBottomRef}
                    onFork={session.forkFromMessage}
                    onFileClick={(path) => setFileViewer(path)}
                    onOpenWorkspace={session.openWorkspace}
                    displayPreferences={displayPreferences()}
                    isStreaming={session.isStreaming}
                    hasMoreHistoryBefore={session.hasMoreHistoryBefore}
                    isLoadingOlderHistory={session.isLoadingOlderHistory}
                    onLoadOlderHistory={session.loadOlderSessionMessages}
                  />

                  <Show when={session.error}>
                    {(getErr) => (
                      <div class="error-toast">
                        <span>{getErr()}</span>
                        <button type="button" onClick={() => session.setError(null)}>
                          ×
                        </button>
                      </div>
                    )}
                  </Show>

                  <Composer
                    input={session.input}
                    isStreaming={session.isStreaming}
                    isShellRunning={session.isShellRunning}
                    queueMode={session.queueMode}
                    workspaceName={workspaceName()}
                    steeringQueue={session.steeringQueue}
                    followUpQueue={session.followUpQueue}
                    setTextareaRef={session.setTextareaRef}
                    cwd={cwd()}
                    attachedFiles={attachedFiles()}
                    onAddFile={addAttachedFile}
                    onRemoveFile={removeAttachedFile}
                    lineComments={lineComments()}
                    onRemoveLineComment={removeLineComment}
                    loadedSkills={loadedSkills()}
                    onAddSkill={addLoadedSkill}
                    onRemoveSkill={removeLoadedSkill}
                    models={visibleModels()}
                    currentModel={session.currentModel}
                    onSelectModel={session.selectModel}
                    thinkingLevel={session.thinkingLevel}
                    onThinkingLevel={session.selectThinkingLevel}
                    onConnectProvider={() => setConnectProviderOpen(true)}
                    onManageModels={() => setManageModelsOpen(true)}
                    onInput={session.setInput}
                    onQueueMode={session.setQueueMode}
                    onSend={() => {
                      void handleSend()
                    }}
                    onShellSend={() => {
                      void session.sendShell()
                    }}
                    onAbort={() => {
                      void window.openpi.abort()
                    }}
                    contextPercent={session.contextPercent}
                  />
                </main>

                <TerminalPanel
                  cwd={cwd()}
                  isOpen={terminalOpen()}
                  newTerminalRequest={newTerminalRequest()}
                  onClose={() => setTerminalOpen(false)}
                />
              </div>

              <Show when={secondaryPanelOpen()}>
                <ResizeHandle direction="horizontal" onResize={resizeGitPanel} />
                <GitPanel
                  style={{ width: `${gitPanelWidth()}px` }}
                  cwd={cwd()}
                  activeTab={gitPanelTab()}
                  onActiveTabChange={setGitPanelTab}
                  onRequestFileSearch={() => {
                    setGitPanelTab('files')
                    setFileSearchOpen(true)
                  }}
                  onDiffOpen={(diff, files, idx) => {
                    batch(() => {
                      setActiveDiff(diff)
                      setDiffFiles(files)
                      setDiffIndex(idx)
                    })
                  }}
                  onFileClick={(relPath) => setFileViewer(relPath)}
                />
              </Show>
            </div>

            <Show when={fileViewer()}>
              {(getPath) => (
                <FileViewerModal
                  relativePath={getPath()}
                  cwd={cwd()}
                  workspaceName={workspaceName()}
                  background={fileSearchOpen()}
                  onAddLineComment={addLineComment}
                  onClose={() => setFileViewer(null)}
                />
              )}
            </Show>

            <Show when={fileSearchOpen()}>
              <FileSearchModal
                cwd={cwd()}
                onClose={() => setFileSearchOpen(false)}
                onFileClick={(path) => setFileViewer(path)}
              />
            </Show>

            <Show when={commandPaletteOpen()}>
              <CommandPalette
                cwd={cwd()}
                commands={paletteCommands()}
                sessions={session.sessions}
                onClose={() => setCommandPaletteOpen(false)}
                onOpenFile={(path) => setFileViewer(path)}
                onOpenSession={session.openExistingSession}
              />
            </Show>

            <Show when={activeDiff()}>
              {(getDiff) => (
                <DiffViewer
                  diff={getDiff()}
                  allFiles={diffFiles()}
                  currentIndex={diffIndex()}
                  onNavigate={async (idx) => {
                    setDiffIndex(idx)
                    const file = diffFiles()[idx]
                    if (file) {
                      const d = await window.openpi.git.getDiff(file.path)
                      if (d) setActiveDiff(d)
                    }
                  }}
                  onClose={() => setActiveDiff(null)}
                />
              )}
            </Show>

            <CustomizationsModal
              open={customizationsOpen()}
              appName={appName()}
              appVersionLabel={appVersionLabel()}
              models={session.models}
              currentModel={session.currentModel}
              onSelectModel={session.selectModel}
              onClose={() => setCustomizationsOpen(false)}
              onError={session.setError}
              cwd={cwd()}
            />

            <Show when={connectProviderOpen()}>
              <ConnectProviderModal
                onClose={() => setConnectProviderOpen(false)}
                onConnected={() => session.refreshModels()}
              />
            </Show>

            <Show when={archivePending()}>
              {(getPending) => (
                <ArchiveConfirmModal
                  workspaceName={getPending().label}
                  sessionCount={getPending().paths.length}
                  onConfirm={(skipNext) => {
                    void handleArchiveConfirm(skipNext)
                  }}
                  onCancel={() => setArchivePending(null)}
                />
              )}
            </Show>

            <Show when={manageModelsOpen()}>
              <ManageModelsModal
                models={session.models}
                hiddenModels={hiddenModels()}
                onToggle={toggleHiddenModel}
                onClose={() => setManageModelsOpen(false)}
                onConnectProvider={() => {
                  setManageModelsOpen(false)
                  setConnectProviderOpen(true)
                }}
              />
            </Show>
          </div>
        )
      }}
    </Show>
  )
}
