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
import { createEffect, createMemo, createSignal, on, onMount, Show } from 'solid-js'
import { BottomBar, type LeftDrawerMode } from './components/BottomBar'
import { FileTree } from './components/git/FileTree'
import { RefsPickerPanel } from './components/git/RefsPickerPanel'
import { ResizeHandle } from './components/ResizeHandle'
import { TopBar } from './components/TopBar'
import { Welcome } from './components/Welcome'
import { AppOverlays } from './components/workbench/AppOverlays'
import { ConversationWorkspace } from './components/workbench/ConversationWorkspace'
import { GitSidePanel } from './components/workbench/GitSidePanel'
import { WorkbenchSidebar } from './components/workbench/WorkbenchSidebar'
import { useAppArchive } from './hooks/useAppArchive'
import { useAppFileManager } from './hooks/useAppFileManager'
import { useAppKeybindings } from './hooks/useAppKeybindings'
import { useAppPrefs } from './hooks/useAppPrefs'
import { useOpenPiSession } from './hooks/useOpenPiSession'
import { useWorkbenchLayout } from './hooks/useWorkbenchLayout'
import { DEFAULT_DISPLAY_PREFERENCES, type DisplayPreferences } from './lib/displayPreferences'
import type { AppInfo, GitSyncAction } from './lib/ipc'
import type { KeybindingOverrides } from './lib/keybindings'

export default function App() {
  const session = useOpenPiSession()

  const [customizationsOpen, setCustomizationsOpen] = createSignal(false)
  const [terminalOpen, setTerminalOpen] = createSignal(false)
  const [newTerminalRequest, setNewTerminalRequest] = createSignal(0)
  const [sidebarOpen, setSidebarOpen] = createSignal(true)
  const [leftDrawerMode, setLeftDrawerMode] = createSignal<LeftDrawerMode>('threads')
  const [gitPanelOpen, setGitPanelOpen] = createSignal(false)
  const [scrollToMessageId, setScrollToMessageId] = createSignal<string | null>(null)
  const scrollToMessageNonce = 0
  const [treeRefreshVersion, setTreeRefreshVersion] = createSignal(0)
  let prevStreaming = false

  const toggleLeftDrawerMode = (mode: LeftDrawerMode) => {
    if (sidebarOpen() && leftDrawerMode() === mode) {
      setSidebarOpen(false)
      return
    }
    setLeftDrawerMode(mode)
    setSidebarOpen(true)
  }
  // Bump treeRefreshVersion when agent finishes a turn so SessionTreePanel re-fetches
  createEffect(
    on(
      () => session.isStreaming,
      (streaming) => {
        if (prevStreaming && !streaming) {
          setTreeRefreshVersion((v) => v + 1)
        }
        prevStreaming = streaming
      }
    )
  )

  const onToggleTree = () => toggleLeftDrawerMode('tree')

  const {
    gitPanelSide,
    isDraggingGit,
    dropSide,
    sidebarWidth,
    gitPanelWidth,
    previewWidth,
    setWorkbenchRef,
    startGitDrag,
    resizeSidebar,
    resizeGitPanel,
    resizePreview,
  } = useWorkbenchLayout()
  const {
    attachedFiles,
    lineComments,
    loadedSkills,
    hiddenModels,
    activeDiff,
    openFiles,
    activeFileIdx,
    diffFiles,
    diffIndex,
    filePanelOpen,
    fileSearchOpen,
    fileFindOpen,
    setFilePanelOpen,
    setFileSearchOpen,
    setFileFindOpen,
    setHiddenModels,
    setActiveFileIdx,
    setCommitDiffHash,
    setActiveDiff,
    handleDiffOpen,
    openFile,
    closeFile,
    closeDeletedFilePreviews,
    addAttachedFile,
    removeAttachedFile,
    addLineComment,
    removeLineComment,
    addLoadedSkill,
    removeLoadedSkill,
    handleSend,
    toggleHiddenModel,
    openCommitDiff,
    navigateDiff,
  } = useAppFileManager({
    cwd: () => session.selectedWorkspacePath ?? '',
    input: () => session.input,
    send: (prefix) => void session.send(prefix),
  })
  const [gitPanelTab, setGitPanelTab] = createSignal<'changes' | 'history'>('changes')
  // ── Git panel → TopBar bridge ──────────────────────────────────────────────
  // The active GitPanel surfaces its branch/upstream labels here so TopBar can
  // display them as clickable chips, and provides a toggleRefs callback so
  // clicking the branch chip in TopBar opens the refs picker in GitPanel.
  const [gitSyncLabel, setGitSyncLabel] = createSignal<string>('')
  let toggleRefsRef: (() => void) | undefined
  const [gitSyncAction, setGitSyncAction] = createSignal<GitSyncAction | null>(null)
  const [gitSyncMessage, setGitSyncMessage] = createSignal<string | null>(null)
  const [commandPaletteOpen, setCommandPaletteOpen] = createSignal(false)
  const [connectProviderOpen, setConnectProviderOpen] = createSignal(false)
  const [manageModelsOpen, setManageModelsOpen] = createSignal(false)
  const archive = useAppArchive()
  const [displayPreferences, setDisplayPreferences] = createSignal<DisplayPreferences>({
    ...DEFAULT_DISPLAY_PREFERENCES,
  })
  const [customKeybindings, setCustomKeybindings] = createSignal<KeybindingOverrides>({})
  // Rename trigger — TopBar sets this when it mounts so App can call it from a keybinding
  let triggerRename: (() => void) | undefined
  const keybindings = useAppKeybindings({
    customKeybindings,
    setCommandPaletteOpen,
    setTerminalOpen,
    setNewTerminalRequest,
    setGitPanelOpen,
    setFilePanelOpen,
    setFileSearchOpen,
    setFileFindOpen,
    setCustomizationsOpen,
    toggleLeftDrawerMode,
    openFiles,
    activeFileIdx,
    closeFile,
    triggerRename,
    isStreaming: () => session.isStreaming,
    createNewSession: () => session.createNewSession(),
    openWorkspace: () => session.openWorkspace(),
  })
  const [appInfo, setAppInfo] = createSignal<AppInfo | null>(null)
  const appPrefs = useAppPrefs({ setAppInfo, setDisplayPreferences, setCustomKeybindings })
  const appName = createMemo(() => appInfo()?.name ?? 'OpenPi')
  const appVersionLabel = createMemo(() => {
    const info = appInfo()
    if (!info) return null
    return `v${info.version}${info.releaseChannel ? ` · ${info.releaseChannel}` : ''}`
  })

  // ── Workbench context bridge — report visible file to main ──────────
  createEffect(() => {
    const files = openFiles()
    const idx = activeFileIdx()
    const relPath = files[idx]
    const cwd = session.selectedWorkspacePath
    if (relPath && relPath.length > 0 && cwd) {
      const absPath = `${cwd}/${relPath}`
      window.openpi.workbenchContext.update({
        visibleFile: relPath,
        visibleFileAbs: absPath,
        terminalOutput: null,
      })
    } else {
      window.openpi.workbenchContext.update({
        visibleFile: null,
        visibleFileAbs: null,
        terminalOutput: null,
      })
    }
  })

  onMount(() => {
    // Load persisted prefs
    archive.loadPersistedPrefs()
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

    const removePrefs = appPrefs.setupOnMount()
    const removeKeydown = keybindings.setupKeydownHandler()
    return () => {
      removePrefs()
      removeKeydown()
    }
  })

  // ── Archive / pin helpers ─────────────────────────────────────────────────

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
        const remotePreemptedByLocal = createMemo(
          () =>
            session.localActivityAt > 0 && session.remoteSessionUpdatedAt <= session.localActivityAt
        )
        const showingRemoteSession = createMemo(() =>
          Boolean(
            !session.isStreaming &&
              !remotePreemptedByLocal() &&
              session.remoteSessionStatus?.sessionFile &&
              session.remoteSessionMessages.length > 0
          )
        )
        const conversationMessages = createMemo(() =>
          showingRemoteSession() ? session.remoteSessionMessages : session.messages
        )
        const conversationStreaming = createMemo(
          () =>
            session.isStreaming ||
            (!remotePreemptedByLocal() && session.remoteSessionStatus?.status === 'running')
        )
        const showRemoteSessionBar = createMemo(() =>
          Boolean(
            !remotePreemptedByLocal() &&
              (session.remoteSessionStatus?.status === 'running' || showingRemoteSession())
          )
        )

        const visibleModels = () =>
          session.models.filter((m) => !hiddenModels().has(`${m.provider}/${m.id}`))

        return (
          <div class={`app-shell${conversationStreaming() ? ' agent-streaming' : ''}`}>
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

            <div class="workbench" ref={setWorkbenchRef}>
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

              <WorkbenchSidebar
                sidebarOpen={sidebarOpen()}
                sidebarWidth={sidebarWidth()}
                leftDrawerMode={leftDrawerMode()}
                session={{
                  workspaces: session.workspaces,
                  selectedWorkspacePath: session.selectedWorkspacePath,
                  selectWorkspace: session.selectWorkspace,
                  openWorkspace: session.openWorkspace,
                  sessions: session.sessions,
                  sessionQuery: session.sessionQuery ?? '',
                  sortBy: session.sortBy,
                  groupBy: session.groupBy,
                  showRecent: session.showRecent,
                  collapsedGroups: session.collapsedGroups,
                  setSessionQuery: session.setSessionQuery,
                  setSortBy: session.setSortBy,
                  setGroupBy: session.setGroupBy,
                  setShowRecent: session.setShowRecent,
                  collapseAllGroups: session.collapseAllGroups,
                  toggleGroup: session.toggleGroup,
                  createNewSession: session.createNewSession,
                  openExistingSession: session.openExistingSession,
                }}
                archive={archive}
                activeSessionPath={activeSessionPath()}
                setLeftDrawerMode={setLeftDrawerMode}
                setSidebarOpen={setSidebarOpen}
                setScrollToMessageId={setScrollToMessageId}
                scrollToMessageNonce={scrollToMessageNonce}
                treeRefreshVersion={treeRefreshVersion()}
                onResize={resizeSidebar}
              />

              <GitSidePanel
                visible={gitPanelOpen() && gitPanelSide() === 'left'}
                side="left"
                cwd={cwd()}
                width={gitPanelWidth()}
                activeTab={gitPanelTab()}
                onActiveTabChange={setGitPanelTab}
                onDragStart={startGitDrag}
                onResize={resizeGitPanel}
                onRequestFileSearch={() => setFileSearchOpen(true)}
                onDiffOpen={handleDiffOpen}
                onCommitFileClick={openCommitDiff}
                onFileClick={openFile}
                onSyncLabelChange={setGitSyncLabel}
                onSyncActionChange={setGitSyncAction}
                onSyncMessageChange={setGitSyncMessage}
              />

              <ConversationWorkspace
                session={session}
                cwd={cwd()}
                workspaceName={workspaceName()}
                activeSessionPath={activeSessionPath()}
                messages={conversationMessages()}
                isStreaming={conversationStreaming()}
                displayPreferences={displayPreferences()}
                scrollToMessageId={scrollToMessageId()}
                showRemoteSessionBar={showRemoteSessionBar()}
                promptHistory={promptHistory()}
                attachedFiles={attachedFiles()}
                lineComments={lineComments()}
                loadedSkills={loadedSkills()}
                visibleModels={visibleModels()}
                openFiles={openFiles()}
                activeFileIdx={activeFileIdx()}
                previewWidth={previewWidth()}
                fileSearchOpen={fileSearchOpen()}
                fileFindOpen={fileFindOpen()}
                terminalOpen={terminalOpen()}
                newTerminalRequest={newTerminalRequest()}
                onOpenFile={openFile}
                onAddAttachedFile={addAttachedFile}
                onRemoveAttachedFile={removeAttachedFile}
                onAddLineComment={addLineComment}
                onRemoveLineComment={removeLineComment}
                onAddSkill={addLoadedSkill}
                onRemoveSkill={removeLoadedSkill}
                onConnectProvider={() => setConnectProviderOpen(true)}
                onManageModels={() => setManageModelsOpen(true)}
                onSend={() => void handleSend()}
                onResizePreview={resizePreview}
                onSelectFile={setActiveFileIdx}
                onCloseFile={closeFile}
                onFindOpened={() => setFileFindOpen(false)}
                onCloseTerminal={() => setTerminalOpen(false)}
              />
              <GitSidePanel
                visible={gitPanelOpen() && gitPanelSide() === 'right'}
                side="right"
                cwd={cwd()}
                width={gitPanelWidth()}
                activeTab={gitPanelTab()}
                onActiveTabChange={setGitPanelTab}
                onDragStart={startGitDrag}
                onResize={resizeGitPanel}
                onRequestFileSearch={() => {
                  setFilePanelOpen(true)
                  setFileSearchOpen(true)
                }}
                onDiffOpen={handleDiffOpen}
                onCommitFileClick={openCommitDiff}
                onFileClick={openFile}
                onSyncLabelChange={setGitSyncLabel}
                onSyncActionChange={setGitSyncAction}
                onSyncMessageChange={setGitSyncMessage}
              />
              {/* File tree panel — separate from git panel */}
              <Show when={filePanelOpen()}>
                <ResizeHandle direction="horizontal" onResize={() => {}} />
                <div class="file-panel" style={{ width: '240px' }}>
                  <FileTree
                    cwd={cwd()}
                    changedPaths={new Set()}
                    onFileClick={(relPath) => openFile(relPath)}
                    onFileDeleted={closeDeletedFilePreviews}
                  />
                </div>
              </Show>
            </div>

            <BottomBar
              leftDrawerOpen={sidebarOpen()}
              leftDrawerMode={leftDrawerMode()}
              onToggleThreads={() => toggleLeftDrawerMode('threads')}
              onToggleWorkspace={() => toggleLeftDrawerMode('workspace')}
              onToggleTree={onToggleTree}
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
              goalUpdate={session.goalUpdate}
            />

            <AppOverlays
              cwd={cwd()}
              fileSearchOpen={fileSearchOpen()}
              commandPaletteOpen={commandPaletteOpen()}
              activeDiff={activeDiff()}
              diffFiles={diffFiles()}
              diffIndex={diffIndex()}
              customizationsOpen={customizationsOpen()}
              connectProviderOpen={connectProviderOpen()}
              manageModelsOpen={manageModelsOpen()}
              archivePending={archive.archivePending()}
              commands={keybindings.paletteCommands()}
              sessions={session.sessions}
              appName={appName()}
              appVersionLabel={appVersionLabel()}
              models={session.models}
              currentModel={session.currentModel}
              hiddenModels={hiddenModels()}
              onCloseFileSearch={() => setFileSearchOpen(false)}
              onOpenFile={openFile}
              onCloseCommandPalette={() => setCommandPaletteOpen(false)}
              onOpenSession={session.openExistingSession}
              onNavigateDiff={(index) => void navigateDiff(index)}
              onCloseDiff={() => {
                setActiveDiff(null)
                setCommitDiffHash(null)
              }}
              onCloseCustomizations={() => setCustomizationsOpen(false)}
              onSelectModel={session.selectModel}
              onError={session.setError}
              onCloseConnectProvider={() => setConnectProviderOpen(false)}
              onProviderConnected={() => session.refreshModels()}
              onArchiveConfirm={(skipNext) => void archive.handleArchiveConfirm(skipNext)}
              onArchiveCancel={() => archive.setArchivePending(null)}
              onToggleHiddenModel={toggleHiddenModel}
              onCloseManageModels={() => setManageModelsOpen(false)}
              onConnectProviderFromModels={() => {
                setManageModelsOpen(false)
                setConnectProviderOpen(true)
              }}
            />
          </div>
        )
      }}
    </Show>
  )
}
