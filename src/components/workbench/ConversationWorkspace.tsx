import { GitBranch, X } from 'lucide-solid'
import { createEffect, createMemo, createSignal, Show } from 'solid-js'
import type { useAgentReviewChanges } from '../../hooks/useAgentReviewChanges'
import { useFileContentCache } from '../../hooks/useFileContentCache'
import { useGitHistoryState } from '../../hooks/useGitHistoryState'
import type { useOpenPiSession } from '../../hooks/useOpenPiSession'
import { buildCoreSlashCommands, type CoreSlashCommand } from '../../lib/coreCommands'
import type { DisplayPreferences } from '../../lib/displayPreferences'
import type { FileLineComment, NewFileLineComment } from '../../lib/fileLineComments'
import type { GitChangedFile, GitFileDiff, ModelInfo, SkillItem } from '../../lib/ipc'
import { isDiffPreviewTab } from '../../lib/previewTabs'
import { AskWidget } from '../AskWidget'
import { Composer } from '../Composer'
import { ConversationPane } from '../conversation/ConversationPane'
import { FilePreviewPane } from '../FilePreviewPane'
import { FileTabBar } from '../FileTabBar'
import { GitHistoryTab } from '../git/GitHistoryTab'
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
  showRemoteSessionBar: boolean
  promptHistory: string[]
  attachedFiles: string[]
  lineComments: FileLineComment[]
  loadedSkills: SkillItem[]
  visibleModels: ModelInfo[]
  openFiles: string[]
  activeFileIdx: number
  previewWidth: number
  activeDiff: GitFileDiff | null
  diffFiles: GitChangedFile[]
  diffIndex: number
  fileSearchOpen: boolean
  fileFindOpen: boolean
  showGitHistory: boolean
  onShowGitHistoryChange: (show: boolean) => void
  onOpenFile: (path: string) => void

  onAddAttachedFile: (path: string) => void
  onRemoveAttachedFile: (path: string) => void
  onAddLineComment: (comment: NewFileLineComment) => void
  onRemoveLineComment: (id: string) => void
  onAddSkill: (skill: SkillItem) => void
  onRemoveSkill: (name: string) => void
  onConnectProvider: () => void
  onManageModels: () => void
  onSend: () => void
  onResizePreview: (delta: number) => void
  onSelectFile: (index: number) => void
  onCloseFile: (index: number) => void
  onNavigateDiff: (index: number) => void
  onCloseDiff: () => void
  onRequestFileSearch: () => void
  onFindOpened: () => void
  onOpenReviewTab: () => void
}

export function ConversationWorkspace(props: ConversationWorkspaceProps) {
  const activePreviewTab = createMemo(() => props.openFiles[props.activeFileIdx] ?? '')
  const reviewChangeCount = createMemo(() => props.agentReview.changes.length)
  const [historyActive, setHistoryActive] = createSignal(false)
  const [reviewSource, setReviewSource] = createSignal<'git' | 'last-turn'>('git')
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
      props.onOpenReviewTab()
    } else if (count === 0 && reviewSource() === 'last-turn') {
      setReviewSource('git')
    }
    lastReviewChangeCount = count
  })

  createEffect(() => {
    if (props.activeDiff?.path) setReviewSource('git')
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
      onOpenSettings: () => props.onManageModels(),
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
      onShowError: (msg) => {
        window.alert(msg)
      },
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
        class={`main-panel${props.openFiles.length > 0 || props.showGitHistory || reviewChangeCount() > 0 ? ' main-panel--split' : ''}`}
      >
        <div class="main-panel-conversation">
          <ConversationPane
            messages={props.messages}
            workspaceName={props.workspaceName}
            workspaceSummary={props.session.workspaceSummary}
            activeSessionPath={props.activeSessionPath}
            setBottomRef={props.session.setBottomRef}
            onFork={props.session.forkFromMessage}
            onFileClick={props.onOpenFile}
            onOpenWorkspace={props.session.openWorkspace}
            displayPreferences={props.displayPreferences}
            isStreaming={props.isStreaming}
            hasMoreHistoryBefore={props.session.hasMoreHistoryBefore}
            isLoadingOlderHistory={props.session.isLoadingOlderHistory}
            onLoadOlderHistory={props.session.loadOlderSessionMessages}
            scrollToMessageId={props.scrollToMessageId}
          />

          <div class="widget-tray">
            <SubagentWidget agents={props.session.agents} />
            <SubagentFileWidget
              artifacts={props.session.artifacts}
              onDismiss={() => props.session.clearArtifacts()}
            />
            <TodoListTray todoFiles={props.session.todoFiles} />
            <Show when={props.session.askState}>
              {(state) => (
                <AskWidget
                  state={state()}
                  onAnswer={(formatted) => void props.session.submitAsk(formatted)}
                  onDismiss={() => props.session.dismissAsk()}
                />
              )}
            </Show>
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

          <Show when={props.session.subagentNotification}>
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
                  {notif().status === 'completed' ? 'Subagent complete' : 'Subagent failed'}:{' '}
                  {notif().description}
                </span>
                <button
                  type="button"
                  class="subagent-notification-dismiss"
                  onClick={() => props.session.dismissSubagentNotification()}
                >
                  ×
                </button>
              </div>
            )}
          </Show>

          <Composer
            input={props.session.input}
            isStreaming={props.session.isStreaming}
            isShellRunning={props.session.isShellRunning}
            queueMode={props.session.queueMode}
            workspaceName={props.workspaceName}
            promptHistory={props.promptHistory}
            steeringQueue={props.session.steeringQueue}
            followUpQueue={props.session.followUpQueue}
            setTextareaRef={props.session.setTextareaRef}
            cwd={props.cwd}
            attachedFiles={props.attachedFiles}
            onAddFile={props.onAddAttachedFile}
            onRemoveFile={props.onRemoveAttachedFile}
            lineComments={props.lineComments}
            onRemoveLineComment={props.onRemoveLineComment}
            loadedSkills={props.loadedSkills}
            onAddSkill={props.onAddSkill}
            onRemoveSkill={props.onRemoveSkill}
            models={props.visibleModels}
            currentModel={props.session.currentModel}
            onSelectModel={props.session.selectModel}
            thinkingLevel={props.session.thinkingLevel}
            onThinkingLevel={props.session.selectThinkingLevel}
            onConnectProvider={props.onConnectProvider}
            onManageModels={props.onManageModels}
            onInput={props.session.setInput}
            onQueueMode={props.session.setQueueMode}
            onSend={props.onSend}
            onShellSend={() => void props.session.sendShell()}
            onAbort={() => void window.openpi.abort()}
            contextPercent={props.session.contextPercent}
            sessionStats={props.session.sessionStats}
            agentTps={props.session.agentRunMetrics?.tps ?? null}
            availableAgentTypes={[
              { name: 'worker', description: 'Surgical implementer' },
              { name: 'explorer', description: 'Read-only codebase cartographer' },
              { name: 'scout', description: 'External research specialist' },
              { name: 'planner', description: 'Architecture and implementation plans' },
              { name: 'reviewer', description: 'Code review and debugging' },
            ]}
            coreCommands={() => coreCommands()}
          />
        </div>

        <Show when={props.openFiles.length > 0 || props.showGitHistory}>
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
              <Show when={props.openFiles.length > 0}>
                <FileTabBar
                  files={props.openFiles}
                  activeIndex={historyActive() ? -1 : props.activeFileIdx}
                  onSelect={(index) => {
                    setHistoryActive(false)
                    props.onSelectFile(index)
                  }}
                  onClose={props.onCloseFile}
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
                      background={props.fileSearchOpen}
                      findOpen={props.fileFindOpen}
                      onFindOpened={props.onFindOpened}
                      onAddLineComment={props.onAddLineComment}
                      onClose={() => props.onCloseFile(props.activeFileIdx)}
                    />
                  }
                >
                  <ReviewPane
                    cwd={props.cwd}
                    source={reviewSource()}
                    onSourceChange={setReviewSource}
                    agentReview={props.agentReview}
                    requestedGitPath={props.activeDiff?.path ?? null}
                    comments={props.lineComments}
                    onAddComment={props.onAddLineComment}
                    onRemoveComment={props.onRemoveLineComment}
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
    </div>
  )
}
