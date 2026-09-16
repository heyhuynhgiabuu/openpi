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
import { createMemo, createSignal, Show } from 'solid-js'
import { ConfirmDialog } from './components/ConfirmDialog'
import { ExtensionUiOverlay } from './components/ExtensionUiOverlay'
import { RefsPickerPanel } from './components/git/RefsPickerPanel'
import { ToolShimmerPane } from './components/ToolShimmerPane'
import { TopBar } from './components/TopBar'
import { Welcome } from './components/Welcome'
import { AppOverlays } from './components/workbench/AppOverlays'
import { WorkbenchLayout } from './components/workbench/WorkbenchLayout'
import { useAgentReviewChanges } from './hooks/useAgentReviewChanges'
import { useAppArchive } from './hooks/useAppArchive'
import { useAppFileManager } from './hooks/useAppFileManager'
import { useAppKeybindings } from './hooks/useAppKeybindings'
import { useAppPrefs } from './hooks/useAppPrefs'
import { useOpenPiSession } from './hooks/useOpenPiSession'
import { useWorkbenchLayout } from './hooks/useWorkbenchLayout'
import { registerAppGlobalListeners } from './app/appGlobalListeners'
import { createAppSessionMemos } from './app/appSessionMemos'
import { useHomescreenDelete } from './app/useHomescreenDelete'
import { useWorkbenchContextBridge } from './app/useWorkbenchContextBridge'
import { DEFAULT_DISPLAY_PREFERENCES, type DisplayPreferences } from './lib/displayPreferences'
import type { AppInfo, GitSyncAction, SessionListItem } from './lib/ipc'
import type { KeybindingOverrides } from './lib/keybindings'

export default function App() {
  const session = useOpenPiSession()
  const agentReview = useAgentReviewChanges()

  const [customizationsOpen, setCustomizationsOpen] = createSignal(false)
  const [customizationsInitialTab, setCustomizationsInitialTab] = createSignal<
    import('./components/customizations/CustomizationsModal').ActiveTab | undefined
  >(undefined)
  const [terminalOpen, setTerminalOpen] = createSignal(false)
  const [newTerminalRequest, setNewTerminalRequest] = createSignal(0)
  const [gitPanelOpen, _setGitPanelOpen] = createSignal(false)
  const [rightPanelOpen, setRightPanelOpen] = createSignal(true)
  const [scrollToMessageId, setScrollToMessageId] = createSignal<string | null>(null)
  // ConversationPane strips the `:` suffix; the nonce makes a repeat jump re-fire.
  const navigateToMessage = (entryId: string) => setScrollToMessageId(`${entryId}:${Date.now()}`)
  const [homescreenOpen, setHomescreenOpen] = createSignal(false)

  const layout = useWorkbenchLayout()
  const fileManager = useAppFileManager({
    cwd: () => session.selectedWorkspacePath ?? '',
    input: () => session.input,
    send: (prefix) => void session.send(prefix),
  })
  const [gitPanelTab, setGitPanelTab] = createSignal<'changes'>('changes')

  const { pendingDelete, setPendingDelete, requestDeleteSession, confirmDeleteSession } =
    useHomescreenDelete(session)
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
    setFileSearchOpen: fileManager.setFileSearchOpen,
    setFileFindOpen: fileManager.setFileFindOpen,
    setCustomizationsOpen,
    openFiles: fileManager.openFiles,
    activeFileIdx: fileManager.activeFileIdx,
    closeFile: fileManager.closeFile,
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

  useWorkbenchContextBridge(fileManager, session)
  registerAppGlobalListeners({
    session,
    archive,
    appPrefs,
    keybindings,
    setHiddenModels: fileManager.setHiddenModels,
    setFileFindOpen: fileManager.setFileFindOpen,
    setHomescreenOpen,
    setCustomizationsOpen,
    setCustomizationsInitialTab,
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
        const memos = createAppSessionMemos(session, getReady)
        const cwd = memos.cwd
        const activeSessionPath = memos.activeSessionPath

        const [showGitHistory, setShowGitHistory] = createSignal(false)

        const visibleModels = () =>
          session.models.filter((m) => !fileManager.hiddenModels().has(`${m.provider}/${m.id}`))

        return (
          <div class={`app-shell${memos.conversationStreaming() ? ' agent-streaming' : ''}`}>
            {/* RefsPickerPanel: always mounted so TopBar branch click works
                even when the git panel is closed */}
            <RefsPickerPanel
              cwd={cwd()}
              registerToggle={(fn) => {
                toggleRefsRef = fn
              }}
            />
            <TopBar
              workspaceName={memos.workspaceName()}
              gitBranch={session.gitBranch}
              gitStats={session.gitStats}
              gitUpstream={gitSyncLabel() || null}
              gitChangeCount={
                session.gitStats
                  ? (session.gitStats.changed ?? 0) + (session.gitStats.untracked ?? 0) || null
                  : null
              }
              onBranchClick={() => toggleRefsRef?.()}
              sessionName={memos.displayName()}
              isStreaming={memos.conversationStreaming()}
              awaitingPrompt={session.awaitingPrompt}
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

            <WorkbenchLayout
              session={session}
              fm={fileManager}
              agentReview={agentReview}
              layout={layout}
              memos={memos}
              displayPreferences={displayPreferences()}
              scrollToMessageId={scrollToMessageId()}
              navigateToMessage={navigateToMessage}
              visibleModels={visibleModels}
              homescreenOpen={homescreenOpen()}
              setHomescreenOpen={setHomescreenOpen}
              rightPanelOpen={rightPanelOpen()}
              terminalOpen={terminalOpen()}
              newTerminalRequest={newTerminalRequest()}
              setTerminalOpen={setTerminalOpen}
              gitPanelOpen={gitPanelOpen()}
              gitPanelSide={layout.gitPanelSide()}
              gitPanelWidth={layout.gitPanelWidth()}
              gitPanelTab={gitPanelTab()}
              setGitPanelTab={setGitPanelTab}
              setFileSearchOpen={fileManager.setFileSearchOpen}
              setFileFindOpen={fileManager.setFileFindOpen}
              showGitHistory={showGitHistory()}
              setShowGitHistory={setShowGitHistory}
              setGitSyncLabel={setGitSyncLabel}
              setGitSyncAction={setGitSyncAction}
              setGitSyncMessage={setGitSyncMessage}
              requestDeleteSession={requestDeleteSession}
              onConnectProvider={() => setConnectProviderOpen(true)}
              onManageModels={() => setManageModelsOpen(true)}
            />
            <ToolShimmerPane />
            <AppOverlays
              cwd={cwd()}
              fileSearchOpen={fileManager.fileSearchOpen()}
              commandPaletteOpen={commandPaletteOpen()}
              customizationsOpen={customizationsOpen()}
              customizationsInitialTab={customizationsInitialTab()}
              connectProviderOpen={connectProviderOpen()}
              manageModelsOpen={manageModelsOpen()}
              archivePending={archive.archivePending()}
              commands={keybindings.paletteCommands()}
              sessions={session.sessions}
              appName={appName()}
              appVersionLabel={appVersionLabel()}
              models={session.models}
              currentModel={session.currentModel}
              hiddenModels={fileManager.hiddenModels()}
              onCloseFileSearch={() => fileManager.setFileSearchOpen(false)}
              onOpenFile={fileManager.openFile}
              onCloseCommandPalette={() => setCommandPaletteOpen(false)}
              onOpenSession={session.openExistingSession}
              onCloseCustomizations={() => setCustomizationsOpen(false)}
              onSelectModel={session.selectModel}
              onError={session.setError}
              onCloseConnectProvider={() => setConnectProviderOpen(false)}
              onProviderConnected={() => session.refreshModels()}
              onArchiveConfirm={(skipNext) => void archive.handleArchiveConfirm(skipNext)}
              onArchiveCancel={() => archive.setArchivePending(null)}
              onToggleHiddenModel={fileManager.toggleHiddenModel}
              onCloseManageModels={() => setManageModelsOpen(false)}
              onConnectProviderFromModels={() => {
                setManageModelsOpen(false)
                setConnectProviderOpen(true)
              }}
            />
            <ExtensionUiOverlay />
            <ConfirmDialog
              open={pendingDelete() !== null}
              title="Delete session?"
              message={`This will move "${pendingDelete()?.title ?? ''}" to the OS trash. You can restore it from there if needed.`}
              confirmLabel="Delete"
              onConfirm={() => void confirmDeleteSession()}
              onCancel={() => setPendingDelete(null)}
            />
          </div>
        )
      }}
    </Show>
  )
}
