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
import { AskWidget } from './components/AskWidget'
import { BottomBar, type LeftDrawerMode } from './components/BottomBar'
import { CommandPalette, type PaletteCommand } from './components/CommandPalette'
import { Composer } from './components/Composer'
import { ConversationPane } from './components/conversation/ConversationPane'
import { CustomizationsModal } from './components/customizations/CustomizationsModal'
import { FilePreviewPane } from './components/FilePreviewPane'
import { FileTabBar } from './components/FileTabBar'
import { DiffViewer } from './components/git/DiffViewer'
import { FileSearchModal } from './components/git/FileSearchModal'
import { FileTree } from './components/git/FileTree'
import { GitPanel } from './components/git/GitPanel'
import { RefsPickerPanel } from './components/git/RefsPickerPanel'
import { ConnectProviderModal } from './components/providers/ConnectProviderModal'
import { ManageModelsModal } from './components/providers/ManageModelsModal'
import { ResizeHandle } from './components/ResizeHandle'
import { SubagentWidget } from './components/SubagentWidget'
import { ArchiveConfirmModal } from './components/sidebar/ArchiveConfirmModal'
import { SessionSidebar } from './components/sidebar/SessionSidebar'
import { StoryBrowser } from './components/sidebar/StoryBrowser'
import { WorkspacePane } from './components/sidebar/WorkspacePane'
import { TaskWidget } from './components/TaskWidget'
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
import { DEFAULT_GIT_PANEL_SIDE, type GitPanelSide, parseGitPanelSide } from './lib/panelLayout'
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
  const [leftDrawerMode, setLeftDrawerMode] = createSignal<LeftDrawerMode>('threads')
  const [gitPanelOpen, setGitPanelOpen] = createSignal(false)

  const toggleLeftDrawerMode = (mode: LeftDrawerMode) => {
    if (sidebarOpen() && leftDrawerMode() === mode) {
      setSidebarOpen(false)
      return
    }
    setLeftDrawerMode(mode)
    setSidebarOpen(true)
  }
  const onToggleStories = () => toggleLeftDrawerMode('stories')

  // ── Git panel side (left or right of main pane) ───────────────────────────
  // Sessions sidebar is always fixed on the left and is not draggable.
  const [gitPanelSide, setGitPanelSide] = createSignal<GitPanelSide>(DEFAULT_GIT_PANEL_SIDE)

  // ── Git panel drag state ──────────────────────────────────────────────────
  const [isDraggingGit, setIsDraggingGit] = createSignal(false)
  const [dropSide, setDropSide] = createSignal<GitPanelSide | null>(null)
  let workbenchRef: HTMLDivElement | undefined

  /**
   * Drag the git panel to the left or right of the main conversation pane.
   * Cursor position relative to the workbench midpoint determines the target side.
   */
  const _startGitDrag = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingGit(true)
    setDropSide(gitPanelSide())
    document.body.classList.add('panel-dragging')

    const onMove = (ev: MouseEvent) => {
      if (!workbenchRef) return
      const rect = workbenchRef.getBoundingClientRect()
      setDropSide((ev.clientX - rect.left) / rect.width < 0.5 ? 'left' : 'right')
    }

    const onUp = () => {
      const target = dropSide()
      if (target && target !== gitPanelSide()) {
        setGitPanelSide(target)
        void window.openpi.setPref('panel.git_side', target)
      }
      setIsDraggingGit(false)
      setDropSide(null)
      document.body.classList.remove('panel-dragging')
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
  const [gitPanelTab, setGitPanelTab] = createSignal<'changes' | 'history'>('changes')
  // ── Git panel → TopBar bridge ──────────────────────────────────────────────
  // The active GitPanel surfaces its branch/upstream labels here so TopBar can
  // display them as clickable chips, and provides a toggleRefs callback so
  // clicking the branch chip in TopBar opens the refs picker in GitPanel.
  const [gitSyncLabel, setGitSyncLabel] = createSignal<string>('')
  let toggleRefsRef: (() => void) | undefined
  const [gitSyncAction, setGitSyncAction] = createSignal<string | null>(null)
  const [gitSyncMessage, setGitSyncMessage] = createSignal<string | null>(null)
  const [filePanelOpen, setFilePanelOpen] = createSignal(false)
  const [fileSearchOpen, setFileSearchOpen] = createSignal(false)
  const [fileFindOpen, setFileFindOpen] = createSignal(false)
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
  const [openFiles, setOpenFiles] = createSignal<string[]>([])
  const [activeFileIdx, setActiveFileIdx] = createSignal(0)

  const openFile = (relPath: string) => {
    const files = openFiles()
    const existing = files.indexOf(relPath)
    if (existing >= 0) {
      setActiveFileIdx(existing)
    } else {
      const newFiles = [...files, relPath]
      setOpenFiles(newFiles)
      setActiveFileIdx(newFiles.length - 1)
    }
  }

  const closeFile = (idx: number) => {
    const newFiles = openFiles().filter((_, i) => i !== idx)
    setOpenFiles(newFiles)
    if (newFiles.length > 0) {
      setActiveFileIdx((prev) => Math.min(prev, newFiles.length - 1))
    }
  }
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
  const GIT_MIN = 300
  const GIT_MAX = 560
  const PREVIEW_DEFAULT = 480
  const PREVIEW_MIN = 280
  const PREVIEW_MAX = 900

  const [sidebarWidth, setSidebarWidth] = createSignal(SIDEBAR_DEFAULT)
  const [gitPanelWidth, setGitPanelWidth] = createSignal(GIT_PANEL_DEFAULT)
  const [previewWidth, setPreviewWidth] = createSignal(PREVIEW_DEFAULT)

  // Load persisted panel widths and git side once
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
    window.openpi
      .getPref('panel.git_side')
      .then((raw) => setGitPanelSide(parseGitPanelSide(raw)))
      .catch(() => {})
  })

  // Sessions sidebar resize: always on the left, handle on its right edge.
  const resizeSidebar = (delta: number) => {
    setSidebarWidth((prev) => {
      const next = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, prev + delta))
      void window.openpi.setPref('panel.sidebar_width', String(next))
      return next
    })
  }

  // Git panel resize: sign depends on which side of main it is.
  // Left of main  → drag right (+delta) grows the panel.
  // Right of main → drag right (+delta) shrinks it (handle is on its left edge).
  const resizeGitPanel = (delta: number) => {
    const sign = gitPanelSide() === 'left' ? 1 : -1
    setGitPanelWidth((prev) => {
      const next = Math.max(GIT_MIN, Math.min(GIT_MAX, prev + sign * delta))
      void window.openpi.setPref('panel.git_panel_width', String(next))
      return next
    })
  }

  // Preview split: drag handle is on the left edge of preview → negative delta grows it.
  const resizePreview = (delta: number) => {
    setPreviewWidth((prev) => Math.max(PREVIEW_MIN, Math.min(PREVIEW_MAX, prev - delta)))
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
        toggleLeftDrawerMode('threads')
        return
      }
      if (eventMatchesBinding(event, binding('toggleGitPanel'))) {
        event.preventDefault()
        setGitPanelOpen((prev) => !prev)
        return
      }
      if (eventMatchesBinding(event, binding('toggleFileTree'))) {
        event.preventDefault()
        setFilePanelOpen((prev) => !prev)
        return
      }
      if (eventMatchesBinding(event, binding('openFileSearch'))) {
        event.preventDefault()
        setFilePanelOpen(true)
        setFileSearchOpen(true)
        return
      }
      if (eventMatchesBinding(event, binding('closeFileTab'))) {
        if (openFiles().length > 0) {
          event.preventDefault()
          closeFile(activeFileIdx())
        }
        return
      }
      if (eventMatchesBinding(event, binding('searchInFile'))) {
        if (openFiles().length > 0) {
          event.preventDefault()
          setFileFindOpen(true)
        }
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

  const handleDeleteArchivedSession = async (archivedPath: string) => {
    const confirmed = window.confirm(
      'Permanently delete this archived session?\n\nIt will be moved to the system Trash when possible.'
    )
    if (!confirmed) return

    const result = await window.openpi.deleteSessions([archivedPath])
    void loadArchivedSessions()
    if (result.failed > 0) {
      window.alert(
        'OpenPi could not delete this archived session. It may have already moved or be protected.'
      )
    }
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
        setFilePanelOpen(true)
        setFileSearchOpen(true)
      }),
      command('closeFileTab', () => {
        if (openFiles().length > 0) closeFile(activeFileIdx())
      }),
      command('searchInFile', () => {
        if (openFiles().length > 0) setFileFindOpen(true)
      }),
      command('openCustomizations', () => setCustomizationsOpen(true)),
      command('openProject', () => void session.openWorkspace()),
      command('renameSession', () => triggerRename?.()),
      command('toggleSidebar', () => toggleLeftDrawerMode('threads')),
      command('toggleGitPanel', () => setGitPanelOpen((prev) => !prev)),
      command('toggleFileTree', () => setFilePanelOpen((prev) => !prev)),
      command('toggleTerminal', () => setTerminalOpen((prev) => !prev)),
      command('newTerminal', () => {
        setTerminalOpen(true)
        setNewTerminalRequest((prev) => prev + 1)
      }),
      // ── Pi extension commands (forwarded to sidecar) ───────────
      {
        id: 'goalLoop' as KeybindingActionId,
        label: 'Goal / Harness Loop',
        description: 'Set or continue a goal: inspect, classify, act, verify, and report next step',
        keys: '',
        run: () => {
          window.openpi.sendPrompt('/goal ')
        },
      } satisfies PaletteCommand,
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
        const promptHistory = createMemo(() =>
          session.messages
            .filter((message) => message.role === 'user' && message.text.trim().length > 0)
            .map((message) => message.text)
            .reverse()
        )

        const visibleModels = () =>
          session.models.filter((m) => !hiddenModels().has(`${m.provider}/${m.id}`))

        return (
          <div class={`app-shell${session.isStreaming ? ' agent-streaming' : ''}`}>
            {/* RefsPickerPanel: always mounted so TopBar branch click works
                even when the git panel is closed */}
            <RefsPickerPanel
              cwd={cwd()}
              registerToggle={(fn) => {
                toggleRefsRef = fn
              }}
            />
            <TopBar
              workspaceName={workspaceName()}
              gitBranch={session.gitBranch}
              gitStats={session.gitStats}
              gitUpstream={gitSyncLabel() || null}
              gitChangeCount={
                session.gitStats
                  ? (session.gitStats.changed ?? 0) + (session.gitStats.untracked ?? 0) || null
                  : null
              }
              onBranchClick={() => toggleRefsRef?.()}
              sessionName={displayName()}
              isStreaming={session.isStreaming}
              onRenameSession={session.setSessionName}
              onOpenWorkspace={session.openWorkspace}
              models={session.models}
              currentModel={session.currentModel}
              onSelectModel={session.selectModel}
              onOpenSettings={() => setCustomizationsOpen(true)}
              startRenameRef={(fn) => {
                triggerRename = fn
              }}
            />

            <div
              class="workbench"
              ref={(el) => {
                workbenchRef = el
              }}
            >
              {/* Drop zones — shown while git panel is being dragged */}
              <Show when={isDraggingGit()}>
                <div
                  class={`panel-drop-zone panel-drop-zone--left${dropSide() === 'left' ? ' is-over' : ''}`}
                >
                  <span class="panel-drop-zone-hint">← Left of main</span>
                </div>
                <div
                  class={`panel-drop-zone panel-drop-zone--right${dropSide() === 'right' ? ' is-over' : ''}`}
                >
                  <span class="panel-drop-zone-hint">Right of main →</span>
                </div>
              </Show>

              {/* Left drawer — fixed left, switches between Threads, Workspace, and Stories */}
              <Show when={sidebarOpen()}>
                <Show when={leftDrawerMode() === 'workspace'}>
                  <WorkspacePane
                    style={{ width: `${sidebarWidth()}px` }}
                    workspaces={session.workspaces}
                    selectedPath={session.selectedWorkspacePath}
                    activePath={cwd()}
                    onSelectWorkspace={(workspacePath) => {
                      void session.selectWorkspace(workspacePath)
                      setLeftDrawerMode('threads')
                    }}
                    onOpenWorkspace={session.openWorkspace}
                    onNewSessionIn={handleNewSessionIn}
                  />
                </Show>
                <Show when={leftDrawerMode() === 'stories'}>
                  <StoryBrowser cwd={cwd()} onOpenFile={(relPath) => openFile(relPath)} />
                </Show>
                <Show when={leftDrawerMode() === 'threads'}>
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
                    onDeleteArchivedSession={(p) => {
                      void handleDeleteArchivedSession(p)
                    }}
                    onOpenSession={session.openExistingSession}
                  />
                </Show>
                <ResizeHandle direction="horizontal" onResize={resizeSidebar} />
              </Show>

              {/* Git panel LEFT of main — [drag handle][git][resize] */}
              <Show when={gitPanelOpen() && gitPanelSide() === 'left'}>
                <div class="secondary-panel-drag-handle">
                  <button
                    type="button"
                    class="panel-drag-grip"
                    title="Drag to move panel to the other side"
                    aria-label="Drag panel"
                    onMouseDown={_startGitDrag}
                  >
                    ⋮⋮
                  </button>
                </div>
                <div
                  class="secondary-panel"
                  style={{
                    width: `${gitPanelWidth()}px`,
                    display: 'flex',
                    'flex-direction': 'column',
                    'min-width': '0',
                  }}
                >
                  <GitPanel
                    style={{ width: '100%', height: '100%' }}
                    side="left"
                    cwd={cwd()}
                    activeTab={gitPanelTab()}
                    onActiveTabChange={setGitPanelTab}
                    onRequestFileSearch={() => {
                      setFileSearchOpen(true)
                    }}
                    onDiffOpen={(diff, files, idx) => {
                      batch(() => {
                        setActiveDiff(diff)
                        setDiffFiles(files)
                        setDiffIndex(idx)
                      })
                    }}
                    onFileClick={(relPath) => openFile(relPath)}
                    onSyncLabelChange={setGitSyncLabel}
                    onSyncActionChange={(a) => setGitSyncAction(a)}
                    onSyncMessageChange={(m) => setGitSyncMessage(m)}
                  />
                </div>
                <ResizeHandle direction="horizontal" onResize={resizeGitPanel} />
              </Show>

              {/* Main conversation pane — always center, grows to fill */}
              <div class="center-col">
                <main class={`main-panel${openFiles().length > 0 ? ' main-panel--split' : ''}`}>
                  {/* Conversation side — always mounted */}
                  <div class="main-panel-conversation">
                    <ConversationPane
                      messages={session.messages}
                      workspaceName={workspaceName()}
                      workspaceSummary={session.workspaceSummary}
                      activeSessionPath={activeSessionPath()}
                      setBottomRef={session.setBottomRef}
                      onFork={session.forkFromMessage}
                      onFileClick={(path) => openFile(path)}
                      onOpenWorkspace={session.openWorkspace}
                      displayPreferences={displayPreferences()}
                      isStreaming={session.isStreaming}
                      hasMoreHistoryBefore={session.hasMoreHistoryBefore}
                      isLoadingOlderHistory={session.isLoadingOlderHistory}
                      onLoadOlderHistory={session.loadOlderSessionMessages}
                    />

                    {/* Extension widgets — anchored to composer width, animate in from below */}
                    <div class="widget-tray">
                      <SubagentWidget agents={session.agents} />
                      <TaskWidget tasks={session.tasks} onDismiss={() => session.clearTasks()} />
                      <Show when={session.askState}>
                        {(state) => (
                          <AskWidget
                            state={state()}
                            onAnswer={(formatted) => void session.submitAsk(formatted)}
                            onDismiss={() => session.dismissAsk()}
                          />
                        )}
                      </Show>
                    </div>

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
                      promptHistory={promptHistory()}
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
                      activeGoalText={session.activeGoalText}
                      activeGoalStep={session.activeGoalStep}
                      onSetActiveGoal={session.setActiveGoal}
                      contextPercent={session.contextPercent}
                    />
                  </div>

                  {/* File preview side — shown alongside conversation */}
                  {/* File preview side — shown alongside conversation */}
                  <Show when={openFiles().length > 0}>
                    <ResizeHandle direction="horizontal" onResize={resizePreview} />
                    <div class="main-panel-preview" style={{ width: `${previewWidth()}px` }}>
                      <FileTabBar
                        files={openFiles()}
                        activeIndex={activeFileIdx()}
                        onSelect={setActiveFileIdx}
                        onClose={closeFile}
                      />
                      <FilePreviewPane
                        relativePath={openFiles()[activeFileIdx()] ?? ''}
                        cwd={cwd()}
                        workspaceName={workspaceName()}
                        background={fileSearchOpen()}
                        findOpen={fileFindOpen()}
                        onFindOpened={() => setFileFindOpen(false)}
                        onAddLineComment={addLineComment}
                        onClose={() => closeFile(activeFileIdx())}
                      />
                    </div>
                  </Show>
                </main>

                <TerminalPanel
                  cwd={cwd()}
                  isOpen={terminalOpen()}
                  newTerminalRequest={newTerminalRequest()}
                  onClose={() => setTerminalOpen(false)}
                />
              </div>

              {/* Git panel RIGHT of main (default) — [resize][drag handle][git] */}
              <Show when={gitPanelOpen() && gitPanelSide() === 'right'}>
                <div class="secondary-panel-drag-handle">
                  <button
                    type="button"
                    class="panel-drag-grip"
                    title="Drag to move panel to the other side"
                    aria-label="Drag panel"
                    onMouseDown={_startGitDrag}
                  >
                    ⋮⋮
                  </button>
                </div>
                <ResizeHandle direction="horizontal" onResize={resizeGitPanel} />
                <div
                  class="secondary-panel"
                  style={{
                    width: `${gitPanelWidth()}px`,
                    display: 'flex',
                    'flex-direction': 'column',
                    'min-width': '0',
                  }}
                >
                  <GitPanel
                    style={{ width: '100%', height: '100%' }}
                    side="right"
                    cwd={cwd()}
                    activeTab={gitPanelTab()}
                    onActiveTabChange={setGitPanelTab}
                    onRequestFileSearch={() => {
                      setFilePanelOpen(true)
                      setFileSearchOpen(true)
                    }}
                    onDiffOpen={(diff, files, idx) => {
                      batch(() => {
                        setActiveDiff(diff)
                        setDiffFiles(files)
                        setDiffIndex(idx)
                      })
                    }}
                    onFileClick={(relPath) => openFile(relPath)}
                    onSyncLabelChange={setGitSyncLabel}
                    onSyncActionChange={(a) => setGitSyncAction(a)}
                    onSyncMessageChange={(m) => setGitSyncMessage(m)}
                  />
                </div>
              </Show>
              {/* File tree panel — separate from git panel */}
              <Show when={filePanelOpen()}>
                <ResizeHandle direction="horizontal" onResize={() => {}} />
                <div class="file-panel" style={{ width: '240px' }}>
                  <FileTree
                    cwd={cwd()}
                    changedPaths={new Set()}
                    onFileClick={(relPath) => openFile(relPath)}
                  />
                </div>
              </Show>
            </div>

            <BottomBar
              leftDrawerOpen={sidebarOpen()}
              leftDrawerMode={leftDrawerMode()}
              onToggleThreads={() => toggleLeftDrawerMode('threads')}
              onToggleWorkspace={() => toggleLeftDrawerMode('workspace')}
              onToggleStories={onToggleStories}
              gitPanelOpen={gitPanelOpen()}
              onToggleGitPanel={() => setGitPanelOpen((prev) => !prev)}
              filePanelOpen={filePanelOpen()}
              onToggleFilePanel={() => setFilePanelOpen((prev) => !prev)}
              terminalOpen={terminalOpen()}
              onToggleTerminal={() => setTerminalOpen((prev) => !prev)}
              appVersion={appInfo()?.version}
              isStreaming={session.isStreaming}
              gitSyncAction={gitSyncAction()}
              gitSyncMessage={gitSyncMessage()}
            />

            <Show when={fileSearchOpen()}>
              <FileSearchModal
                cwd={cwd()}
                onClose={() => setFileSearchOpen(false)}
                onFileClick={(path) => openFile(path)}
              />
            </Show>

            <Show when={commandPaletteOpen()}>
              <CommandPalette
                cwd={cwd()}
                commands={paletteCommands()}
                sessions={session.sessions}
                onClose={() => setCommandPaletteOpen(false)}
                onOpenFile={(path) => openFile(path)}
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
