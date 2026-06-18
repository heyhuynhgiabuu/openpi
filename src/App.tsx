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
import { createEffect, createMemo, createSignal, onMount, Show } from 'solid-js'
import { ExtensionUiOverlay } from './components/ExtensionUiOverlay'
import { RefsPickerPanel } from './components/git/RefsPickerPanel'
import { Homescreen } from './components/Homescreen'
import { ResizeHandle } from './components/ResizeHandle'
import { ToolShimmerPane } from './components/ToolShimmerPane'
import { TopBar } from './components/TopBar'
import { TerminalPanel } from './components/terminal/TerminalPanel'
import { Welcome } from './components/Welcome'
import { AppOverlays } from './components/workbench/AppOverlays'
import { ConversationWorkspace } from './components/workbench/ConversationWorkspace'
import { GitSidePanel } from './components/workbench/GitSidePanel'
import { RightPanel } from './components/workbench/RightPanel'
import { useAgentReviewChanges } from './hooks/useAgentReviewChanges'
import { useAppArchive } from './hooks/useAppArchive'
import { useAppFileManager } from './hooks/useAppFileManager'
import { useAppKeybindings } from './hooks/useAppKeybindings'
import { useAppPrefs } from './hooks/useAppPrefs'
import { useOpenPiSession } from './hooks/useOpenPiSession'
import { useWorkbenchLayout } from './hooks/useWorkbenchLayout'
import { DEFAULT_DISPLAY_PREFERENCES, type DisplayPreferences } from './lib/displayPreferences'
import type { AppInfo, GitSyncAction, SessionListItem } from './lib/ipc'
import type { KeybindingOverrides } from './lib/keybindings'

export default function App() {
  const session = useOpenPiSession()
  const agentReview = useAgentReviewChanges()

  const [customizationsOpen, setCustomizationsOpen] = createSignal(false)
  const [terminalOpen, setTerminalOpen] = createSignal(false)
  const [newTerminalRequest, setNewTerminalRequest] = createSignal(0)
  const [gitPanelOpen, _setGitPanelOpen] = createSignal(false)
  const [rightPanelOpen, setRightPanelOpen] = createSignal(true)
  const [scrollToMessageId, _setScrollToMessageId] = createSignal<string | null>(null)
  const [homescreenOpen, setHomescreenOpen] = createSignal(false)

  const {
    gitPanelSide,
    isDraggingGit,
    dropSide,
    gitPanelWidth,
    previewWidth,
    setWorkbenchRef,
    startGitDrag,
    resizeGitPanel,
    resizeRightPanel,
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
    fileSearchOpen,
    fileFindOpen,
    setFileSearchOpen,
    setFileFindOpen,
    setHiddenModels,
    setActiveFileIdx,
    setCommitDiffHash,
    setActiveDiff,
    handleDiffOpen,
    openFile,
    openReviewTab,
    closeFile,

    closeDeletedFilePreviews,
    renameFileInPreviews,
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
  const [gitPanelTab, setGitPanelTab] = createSignal<'changes'>('changes')
  // ── Git panel → TopBar bridge ──────────────────────────────────────────────
  // The active GitPanel surfaces its branch/upstream labels here so TopBar can
  // display them as clickable chips, and provides a toggleRefs callback so
  // clicking the branch chip in TopBar opens the refs picker in GitPanel.
  const [gitSyncLabel, setGitSyncLabel] = createSignal<string>('')
  let toggleRefsRef: (() => void) | undefined
  const [_gitSyncAction, setGitSyncAction] = createSignal<GitSyncAction | null>(null)
  const [_gitSyncMessage, setGitSyncMessage] = createSignal<string | null>(null)
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
    setRightPanelOpen,
    setFileSearchOpen,
    setFileFindOpen,
    setCustomizationsOpen,
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
    const removeFileFindShortcut = window.openpi.onFileFindShortcut(() => {
      setFileFindOpen(false)
      queueMicrotask(() => setFileFindOpen(true))
    })

    // Allow slash commands (e.g. /resume) to open the command palette
    // without threading a new prop through the entire tree.
    const openPaletteViaEvent = () => setCommandPaletteOpen(true)
    document.addEventListener('openpi:open-command-palette', openPaletteViaEvent)

    return () => {
      removePrefs()
      removeKeydown()
      removeFileFindShortcut?.()
      document.removeEventListener('openpi:open-command-palette', openPaletteViaEvent)
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

        const [showGitHistory, setShowGitHistory] = createSignal(false)
        const openGitHistory = () => setShowGitHistory(true)

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
              onOpenSettings={() => setCustomizationsOpen(true)}
              startRenameRef={(fn) => {
                triggerRename = fn
              }}
              models={session.models}
              currentModel={session.currentModel}
              onSelectModel={session.selectModel}
              // ── Session tabs ──
              sessions={session.sessions}
              activeSessionPath={activeSessionPath()}
              onSelectSession={(path: string) =>
                void session.openExistingSession({ path } as SessionListItem)
              }
              onNewSession={() => void session.createNewSession()}
              onToggleHomescreen={() => setHomescreenOpen((v) => !v)}
            />

            <div class="workbench" ref={setWorkbenchRef}>
              {/* ── Homescreen (full-width overlay) ── */}
              <Show when={homescreenOpen()}>
                <Homescreen
                  sessions={session.sessions}
                  workspaces={session.workspaces}
                  selectedWorkspacePath={session.selectedWorkspacePath}
                  activeSessionPath={activeSessionPath()}
                  onSelectSession={(path: string) =>
                    void session.openExistingSession({ path } as SessionListItem)
                  }
                  onNewSession={() => void session.createNewSession()}
                  onSelectWorkspace={(path: string) => void session.selectWorkspace(path)}
                  onOpenWorkspace={() => void session.openWorkspace()}
                  onClose={() => setHomescreenOpen(false)}
                />
              </Show>

              {/* ── Normal workspace (hidden when homescreen is open) ── */}
              <Show when={!homescreenOpen()}>
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

                <div class="workbench-main">
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
                    onOpenHistory={openGitHistory}
                  />

                  <ConversationWorkspace
                    session={session}
                    agentReview={agentReview}
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
                    activeDiff={activeDiff()}
                    diffFiles={diffFiles()}
                    diffIndex={diffIndex()}
                    fileSearchOpen={fileSearchOpen()}
                    fileFindOpen={fileFindOpen()}
                    showGitHistory={showGitHistory()}
                    onShowGitHistoryChange={setShowGitHistory}
                    onOpenFile={openFile}
                    onOpenReviewTab={openReviewTab}
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
                    onNavigateDiff={(index) => void navigateDiff(index)}
                    onCloseDiff={() => {
                      setActiveDiff(null)
                      setCommitDiffHash(null)
                    }}
                    onRequestFileSearch={() => setFileSearchOpen(true)}
                    onFindOpened={() => setFileFindOpen(false)}
                  />

                  <Show when={rightPanelOpen()}>
                    <ResizeHandle direction="horizontal" onResize={resizeRightPanel} />
                    <RightPanel
                      visible
                      cwd={cwd()}
                      width={gitPanelWidth()}
                      onResize={resizeRightPanel}
                      changeCount={
                        session.gitStats
                          ? (session.gitStats.changed ?? 0) + (session.gitStats.untracked ?? 0) ||
                            null
                          : null
                      }
                      onDiffOpen={handleDiffOpen}
                      onCommitFileClick={openCommitDiff}
                      onFileClick={openFile}
                      onFileDeleted={closeDeletedFilePreviews}
                      onFileRenamed={renameFileInPreviews}
                      onSyncLabelChange={setGitSyncLabel}
                      onSyncActionChange={setGitSyncAction}
                      onSyncMessageChange={setGitSyncMessage}
                      onOpenHistory={openGitHistory}
                    />
                  </Show>
                </div>

                <TerminalPanel
                  cwd={cwd()}
                  isOpen={terminalOpen()}
                  newTerminalRequest={newTerminalRequest()}
                  onClose={() => setTerminalOpen(false)}
                />
              </Show>
            </div>

            <ToolShimmerPane />
            <AppOverlays
              cwd={cwd()}
              fileSearchOpen={fileSearchOpen()}
              commandPaletteOpen={commandPaletteOpen()}
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
            <ExtensionUiOverlay />
          </div>
        )
      }}
    </Show>
  )
}
