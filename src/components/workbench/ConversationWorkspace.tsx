import { ArrowLeft } from 'lucide-solid'
import { createEffect, createMemo, createSignal, Show } from 'solid-js'
import type { useAgentReviewChanges } from '../../hooks/useAgentReviewChanges'
import type { useAppFileManager } from '../../hooks/useAppFileManager'
import type { useOpenPiSession } from '../../hooks/useOpenPiSession'
import type { DisplayPreferences } from '../../lib/displayPreferences'
import type { ModelInfo, SkillItem } from '../../lib/ipc'
import type { AgentMentionOption } from '../composer/useComposerPickers'
import { Composer } from '../Composer'
import { ConversationPane } from '../conversation/ConversationPane'
import { SessionMap } from '../map/SessionMap'
import { SubagentFileWidget, TodoListTray } from '../SubagentFileWidget'
import { SubagentWidget } from '../SubagentWidget'
import { ConversationPreviewSplit } from './ConversationPreviewSplit'
import { useCoreSlashCommands } from './useCoreSlashCommands'
import { useTaskAgents } from './useTaskAgents'

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

  const taskAgents = useTaskAgents(() => props.cwd)

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

  const coreCommands = useCoreSlashCommands(props.session, {
    onConnectProvider: () => props.onConnectProvider(),
    onOpenSessionMap: () => setSessionMapOpen(true),
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
          <ConversationPreviewSplit
            fm={props.fm}
            agentReview={props.agentReview}
            cwd={props.cwd}
            workspaceName={props.workspaceName}
            activePreviewTab={activePreviewTab}
            historyActive={historyActive}
            setHistoryActive={setHistoryActive}
            reviewSource={reviewSource}
            setReviewSource={setReviewSource}
            showGitHistory={props.showGitHistory}
            onShowGitHistoryChange={props.onShowGitHistoryChange}
            onResizePreview={props.onResizePreview}
            previewWidth={props.previewWidth}
            onRequestFileSearch={props.onRequestFileSearch}
            onFindOpened={props.onFindOpened}
          />
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
