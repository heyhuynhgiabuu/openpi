import { ArrowLeft, GitBranch, X } from 'lucide-solid'
import { createEffect, createMemo, createSignal, onCleanup, Show } from 'solid-js'
import type { useAgentReviewChanges } from '../../hooks/useAgentReviewChanges'
import { useFileContentCache } from '../../hooks/useFileContentCache'
import { useGitHistoryState } from '../../hooks/useGitHistoryState'
import type { useAppFileManager } from '../../hooks/useAppFileManager'
import type { useOpenPiSession } from '../../hooks/useOpenPiSession'
import { buildCoreSlashCommands, type CoreSlashCommand } from '../../lib/coreCommands'
import type { DisplayPreferences } from '../../lib/displayPreferences'
import type { ModelInfo, SkillItem } from '../../lib/ipc'
import { isDiffPreviewTab } from '../../lib/previewTabs'
import type { AgentMentionOption } from '../composer/useComposerPickers'
import { Composer } from '../Composer'
import { ConversationPane } from '../conversation/ConversationPane'
import { FilePreviewPane } from '../FilePreviewPane'
import { FileTabBar } from '../FileTabBar'
import { GitHistoryTab } from '../git/GitHistoryTab'
import { SessionMap } from '../map/SessionMap'
import { ResizeHandle } from '../ResizeHandle'
import { ReviewPane } from '../review/ReviewPane'
import { SubagentFileWidget, TodoListTray } from '../SubagentFileWidget'
import { SubagentWidget } from '../SubagentWidget'

type OpenPiSession = ReturnType<typeof useOpenPiSession>
type AgentReview = ReturnType<typeof useAgentReviewChanges>
type ConversationMessages = Parameters<typeof ConversationPane>[0]['messages']

interface ConversationWorkspaceProps {
  session: OpenPiSession
  agentReview: AgentReview
  cwd: string
  workspaceName: string
  activeSessionPath: string | null
  messages: ConversationMessages
  isStreaming: boolean
  displayPreferences: DisplayPreferences
  scrollToMessageId: string | null
  /** Jump the conversation to a session entry (the session map drives this). */
  onNavigateToMessage: (entryId: string) => void
  /** Cancels one pi-task subagent through pi-task's own control command. */
  onCancelTask: (taskId: string) => Promise<void>
  /** Leaf the session is on when it differs from the file's last entry. */
  branchLeafId: string | null
  /** Increments when Pi writes an entry; the session map refreshes on change. */
  treeVersion: number
  /** Continue the session from an entry, staying in the same session file. */
  onBranchFrom: (entryId: string) => Promise<void>
  showRemoteSessionBar: boolean
  promptHistory: string[]
  visibleModels: ModelInfo[]
  previewWidth: number
  showGitHistory: boolean
  onShowGitHistoryChange: (show: boolean) => void
  onConnectProvider: () => void
  onManageModels: () => void
  onResizePreview: (delta: number) => void
  onRequestFileSearch: () => void
  onFindOpened: () => void
  /** File-preview state and actions (useAppFileManager), passed whole. */
  fm: ReturnType<typeof useAppFileManager>
}

export function ConversationWorkspace(props: ConversationWorkspaceProps) {
  const activePreviewTab = createMemo(() => props.fm.openFiles()[props.fm.activeFileIdx()] ?? '')
  const reviewChangeCount = createMemo(() => props.agentReview.changes.length)
  const [historyActive, setHistoryActive] = createSignal(false)
  const [reviewSource, setReviewSource] = createSignal<'git' | 'last-turn'>('git')
  const [sessionMapOpen, setSessionMapOpen] = createSignal(false)

  // Effective pi-task delegate catalog for @mention suggestions. pi-task owns
  // definitions, precedence and tool policy; the composer only displays what
  // the task tool could actually run. Empty when pi-task is not installed.
  // Keyed on cwd so a workspace switch refetches; main owns the discovery root.
  const [taskAgents, setTaskAgents] = createSignal<AgentMentionOption[]>([])
  createEffect(() => {
    void props.cwd
    let cancelled = false
    void window.openpi
      .getTaskAgents()
      .then((agents) => {
        if (!cancelled) setTaskAgents(agents)
      })
      .catch(() => {
        if (!cancelled) setTaskAgents([])
      })
    onCleanup(() => {
      cancelled = true
    })
  })

  let lastReviewChangeCount = 0

  createEffect(() => {
    if (props.showGitHistory) setHistoryActive(true)
    else setHistoryActive(false)
  })

  createEffect(() => {
    const count = reviewChangeCount()
    if (count > lastReviewChangeCount) {
      setReviewSource('last-turn')
      setHistoryActive(false)
      props.fm.openReviewTab()
    } else if (count === 0 && reviewSource() === 'last-turn') {
      setReviewSource('git')
    }
    lastReviewChangeCount = count
  })

  createEffect(() => {
    if (props.fm.activeDiff()?.path) setReviewSource('git')
  })

  const fileCache = useFileContentCache()

  const coreCommands = createMemo<CoreSlashCommand[]>(() =>
    buildCoreSlashCommands({
      sessionReady: props.session.ready !== null,
      onCompact: (customInstructions) => void props.session.compactSession(customInstructions),
      onReload: () => void props.session.reloadSession(),
      onCopyLast: () => props.session.copyLastAssistantText(),
      onOpenModelPicker: () => {
        document.dispatchEvent(new CustomEvent('openpi:open-model-picker'))
      },
      onOpenSettings: () => {
        document.dispatchEvent(
          new CustomEvent('openpi:open-customizations', { detail: { tab: 'settings' } })
        )
      },
      onOpenLogin: () => props.onConnectProvider(),
      onLogout: () => props.onConnectProvider(),
      onNewSession: () => void props.session.createNewSession(),
      onOpenResumeDialog: () => {
        // Open the homescreen overlay, which lists all sessions and
        // workspaces — the natural place to pick something to resume.
        document.dispatchEvent(new CustomEvent('openpi:open-homescreen'))
      },
      onCycleThinking: () => {
        const order = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const
        const cur = props.session.thinkingLevel as (typeof order)[number]
        const idx = order.indexOf(cur)
        const next = order[(idx + 1) % order.length]
        if (next) void props.session.selectThinkingLevel(next)
      },
      onCycleModel: () => {
        const list = props.session.models
        const cur = props.session.currentModel
        if (!list.length) return
        const idx = cur ? list.findIndex((m) => m.id === cur.id && m.provider === cur.provider) : -1
        const next = list[(idx + 1) % list.length]
        if (next) void props.session.selectModel(next)
      },
      onSetSessionName: (name) => void props.session.setSessionName(name),
      onOpenSessionMap: () => setSessionMapOpen(true),
      onShowSessionInfo: async () => {
        const info = (await props.session.getSessionInfo()) as {
          sessionFile: string | null
          sessionId: string | null
          sessionName: string | null
          model: { name: string; provider: string } | null
          thinkingLevel: string | null
          messageCount: number
          contextUsagePercent: number | null
          contextTokens: number | null
          contextWindow: number | null
        } | null
        if (!info) {
          return
        }
        const lines: string[] = []
        if (info.sessionName) lines.push(`Name: ${info.sessionName}`)
        if (info.sessionId) lines.push(`ID: ${info.sessionId}`)
        if (info.sessionFile) lines.push(`File: ${info.sessionFile}`)
        if (info.model) lines.push(`Model: ${info.model.name} (${info.model.provider})`)
        if (info.thinkingLevel) lines.push(`Thinking: ${info.thinkingLevel}`)
        lines.push(`Messages: ${info.messageCount}`)
        if (info.contextUsagePercent != null) {
          const pct = info.contextUsagePercent.toFixed(1)
          const tokens =
            info.contextTokens != null && info.contextWindow
              ? ` (${info.contextTokens.toLocaleString()} / ${info.contextWindow.toLocaleString()} tokens)`
              : ''
          lines.push(`Context: ${pct}%${tokens}`)
        }
        window.alert(lines.join('\n'))
      },
      onExportSession: () => {
        return window.openpi
          .exportSessionBundle()
          .then((result) => {
            if (result.status === 'cancelled') return
            if (result.status === 'error') {
              window.alert(result.message)
              return
            }
            const lines = [
              `Session exported to:`,
              result.outDir,
              '',
              `${result.files.length} file(s) copied (SHA-256 recorded in manifest.json).`,
            ]
            if (result.subSessionTaskIds.length > 0) {
              lines.push(`Sub-sessions: ${result.subSessionTaskIds.length}`)
            }
            for (const warning of result.warnings) lines.push(`⚠ ${warning}`)
            window.alert(lines.join('\n'))
          })
          .catch((err: unknown) => {
            window.alert(err instanceof Error ? err.message : String(err))
          })
      },
      onShowError: (msg) => {
        window.alert(msg)
      },
      onPrefillInput: (text) => props.session.setInput(text),
    })
  )

  const gitHistoryState = useGitHistoryState({
    activeTab: () => (historyActive() ? ('history' as const) : ('changes' as const)),
    cwd: () => props.cwd,
    isMounted: () => true,
  })

  return (
    <div class="center-col">
      <main
        class={`main-panel${props.fm.openFiles().length > 0 || props.showGitHistory || reviewChangeCount() > 0 ? ' main-panel--split' : ''}`}
      >
        <div class="main-panel-conversation">
          <Show when={props.session.isSubSession()}>
            <nav
              class="sub-session-breadcrumb"
              data-component="sub-session-breadcrumb"
              data-has-parent={props.session.parentStack().length > 0 || undefined}
            >
              <button
                type="button"
                class="sub-session-breadcrumb-back"
                data-slot="sub-session-breadcrumb-back"
                disabled={props.session.parentStack().length === 0}
                title={
                  props.session.parentStack().length === 0
                    ? 'Sub-session — no parent in stack'
                    : 'Back to parent session'
                }
                onClick={() => {
                  void props.session.popToParent()
                }}
              >
                <ArrowLeft size={12} />
                <span data-slot="sub-session-breadcrumb-label">
                  <Show when={props.session.parentStack().length > 0} fallback={<>Sub-session</>}>
                    Back to {props.session.parentStack().at(-1)?.name ?? 'parent'}
                  </Show>
                </span>
              </button>
              <span data-slot="sub-session-breadcrumb-tag" class="sub-session-breadcrumb-tag">
                sub-session
              </span>
            </nav>
          </Show>
          <ConversationPane
            messages={props.messages}
            workspaceName={props.workspaceName}
            workspaceSummary={props.session.workspaceSummary}
            activeSessionPath={props.activeSessionPath}
            setBottomRef={props.session.setBottomRef}
            onFork={props.session.forkFromMessage}
            onFileClick={props.fm.openFile}
            onCancelTask={props.onCancelTask}
            onOpenSubSession={props.session.openSubSession}
            resolveTaskId={(card) => props.session.resolveTaskIdForCard(card)}
            resolveTaskStatus={(taskId) => props.session.resolveTaskStatusForTaskId(taskId)}
            onOpenWorkspace={props.session.openWorkspace}
            displayPreferences={props.displayPreferences}
            isStreaming={props.isStreaming}
            hasMoreHistoryBefore={props.session.hasMoreHistoryBefore}
            isLoadingOlderHistory={props.session.isLoadingOlderHistory}
            onLoadOlderHistory={props.session.loadOlderSessionMessages}
            scrollToMessageId={props.scrollToMessageId}
          />

          <div class="widget-tray">
            <SubagentWidget tasks={props.session.tasks} />
            <SubagentFileWidget
              artifacts={props.session.artifacts}
              onDismiss={() => props.session.clearArtifacts()}
            />
            <TodoListTray todoFiles={props.session.todoFiles} />
          </div>

          <Show when={props.showRemoteSessionBar}>
            <div class="remote-session-bar">
              <span class="remote-session-bar-dot" />
              {props.session.remoteSessionStatus?.status === 'running'
                ? 'Agent running in '
                : 'Mirroring session from '}
              <strong>
                {props.session.remoteSessionStatus?.app === 'pi-tui'
                  ? 'Pi TUI'
                  : (props.session.remoteSessionStatus?.app ?? 'another instance')}
              </strong>
              <Show when={props.session.remoteSessionStatus?.workspace}>
                {(workspace) => <span> — {workspace()}</span>}
              </Show>
            </div>
          </Show>

          <Show when={props.session.error}>
            {(getErr) => (
              <div class="error-toast">
                <span>{getErr()}</span>
                <button type="button" onClick={() => props.session.setError(null)}>
                  ×
                </button>
              </div>
            )}
          </Show>

          <Show when={props.session.taskNotification}>
            {(notif) => (
              <div
                classList={{
                  'subagent-notification': true,
                  'subagent-notification--completed': notif().status === 'completed',
                  'subagent-notification--failed': notif().status === 'failed',
                }}
              >
                <span>
                  <span class="subagent-notification-icon">
                    {notif().status === 'completed' ? '✓' : '✗'}
                  </span>
                  {notif().status === 'completed' ? 'Task complete' : 'Task failed'}:{' '}
                  {notif().description}
                </span>
                <button
                  type="button"
                  class="subagent-notification-dismiss"
                  onClick={() => props.session.dismissTaskNotification()}
                >
                  ×
                </button>
              </div>
            )}
          </Show>

          <Composer
            input={props.session.input}
            isStreaming={props.session.isStreaming}
            awaitingPrompt={props.session.awaitingPrompt}
            isShellRunning={props.session.isShellRunning}
            queueMode={props.session.queueMode}
            workspaceName={props.workspaceName}
            promptHistory={props.promptHistory}
            steeringQueue={props.session.steeringQueue}
            followUpQueue={props.session.followUpQueue}
            setTextareaRef={props.session.setTextareaRef}
            cwd={props.cwd}
            attachedFiles={props.fm.attachedFiles()}
            onAddFile={props.fm.addAttachedFile}
            onRemoveFile={props.fm.removeAttachedFile}
            lineComments={props.fm.lineComments()}
            onRemoveLineComment={props.fm.removeLineComment}
            loadedSkills={props.fm.loadedSkills()}
            onAddSkill={props.fm.addLoadedSkill}
            onRemoveSkill={props.fm.removeLoadedSkill}
            models={props.visibleModels}
            currentModel={props.session.currentModel}
            onSelectModel={props.session.selectModel}
            thinkingLevel={props.session.thinkingLevel}
            onThinkingLevel={props.session.selectThinkingLevel}
            onConnectProvider={props.onConnectProvider}
            onManageModels={props.onManageModels}
            onInput={props.session.setInput}
            onQueueMode={props.session.setQueueMode}
            onSend={props.fm.handleSend}
            onShellSend={() => void props.session.sendShell()}
            onAbort={() => void window.openpi.abort()}
            contextPercent={props.session.contextPercent}
            sessionStats={props.session.sessionStats}
            agentTps={props.session.agentTps ?? null}
            runUsage={props.session.runUsage}
            availableAgentTypes={taskAgents()}
            coreCommands={() => coreCommands()}
          />
        </div>

        <Show when={props.fm.openFiles().length > 0 || props.showGitHistory}>
          <ResizeHandle direction="horizontal" onResize={props.onResizePreview} />
          <div class="main-panel-preview" style={{ width: `${props.previewWidth}px` }}>
            <div class="main-panel-preview-header">
              <Show when={props.showGitHistory}>
                <div
                  role="tab"
                  tabIndex={0}
                  aria-selected={historyActive()}
                  class={`gh-btn${historyActive() ? ' gh-btn--active' : ''}`}
                  title="Git History"
                  onClick={() => setHistoryActive(true)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setHistoryActive(true)
                    }
                  }}
                >
                  <GitBranch size={13} />
                  <span>History</span>
                  <button
                    type="button"
                    class="ftb-tab-close"
                    title="Close Git History"
                    aria-label="Close Git History"
                    onClick={(event) => {
                      event.stopPropagation()
                      props.onShowGitHistoryChange(false)
                    }}
                  >
                    <X size={11} strokeWidth={2.2} />
                  </button>
                </div>
              </Show>
              <Show when={props.fm.openFiles().length > 0}>
                <FileTabBar
                  files={props.fm.openFiles()}
                  activeIndex={historyActive() ? -1 : props.fm.activeFileIdx()}
                  onSelect={(index) => {
                    setHistoryActive(false)
                    props.fm.setActiveFileIdx(index)
                  }}
                  onClose={props.fm.closeFile}
                  onRequestFileSearch={props.onRequestFileSearch}
                />
              </Show>
            </div>
            <Show
              when={historyActive()}
              fallback={
                <Show
                  when={isDiffPreviewTab(activePreviewTab())}
                  fallback={
                    <FilePreviewPane
                      relativePath={activePreviewTab()}
                      cwd={props.cwd}
                      workspaceName={props.workspaceName}
                      background={props.fm.fileSearchOpen()}
                      findOpen={props.fm.fileFindOpen()}
                      onFindOpened={props.onFindOpened}
                      onAddLineComment={props.fm.addLineComment}
                      onClose={() => props.fm.closeFile(props.fm.activeFileIdx())}
                    />
                  }
                >
                  <ReviewPane
                    cwd={props.cwd}
                    source={reviewSource()}
                    onSourceChange={setReviewSource}
                    agentReview={props.agentReview}
                    requestedGitPath={props.fm.activeDiff()?.path ?? null}
                    comments={props.fm.lineComments()}
                    onAddComment={props.fm.addLineComment}
                    onRemoveComment={props.fm.removeLineComment}
                    fileContentFor={fileCache.fileContentFor}
                    ensureFileContent={fileCache.ensureFileContent}
                  />
                </Show>
              }
            >
              <GitHistoryTab
                history={gitHistoryState.history()}
                historyQuery={gitHistoryState.historyQuery()}
                historyLoading={gitHistoryState.historyLoading()}
                historyError={gitHistoryState.historyError()}
                selectedCommit={gitHistoryState.selectedCommit()}
                graphColumnsByHash={gitHistoryState.graphColumnsByHash()}
                maxGraphColumns={gitHistoryState.maxGraphColumns()}
                onHistoryQueryChange={gitHistoryState.setHistoryQuery}
                onLoadHistory={(query) => void gitHistoryState.loadHistory(query)}
                onSelectCommit={gitHistoryState.setSelectedCommit}
              />
            </Show>
          </div>
        </Show>
      </main>

      <Show when={sessionMapOpen() ? (props.session.ready?.sessionFile ?? null) : null}>
        {(sessionPath) => (
          <SessionMap
            sessionPath={sessionPath()}
            leafId={props.branchLeafId}
            treeVersion={props.treeVersion}
            onClose={() => setSessionMapOpen(false)}
            isEntryLoaded={(entryId) => props.messages.some((message) => message.id === entryId)}
            onNavigate={props.onNavigateToMessage}
            onBranchFrom={props.onBranchFrom}
          />
        )}
      </Show>
    </div>
  )
}
