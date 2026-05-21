import { Show } from 'solid-js'
import type { useOpenPiSession } from '../../hooks/useOpenPiSession'
import type { DisplayPreferences } from '../../lib/displayPreferences'
import type { FileLineComment, NewFileLineComment } from '../../lib/fileLineComments'
import type { ModelInfo, SkillItem } from '../../lib/ipc'
import { AskWidget } from '../AskWidget'
import { Composer } from '../Composer'
import { ConversationPane } from '../conversation/ConversationPane'
import { FilePreviewPane } from '../FilePreviewPane'
import { FileTabBar } from '../FileTabBar'
import { ResizeHandle } from '../ResizeHandle'
import { SubagentWidget } from '../SubagentWidget'
import { TaskWidget } from '../TaskWidget'
import { TerminalPanel } from '../terminal/TerminalPanel'

type OpenPiSession = ReturnType<typeof useOpenPiSession>
type ConversationMessages = Parameters<typeof ConversationPane>[0]['messages']

interface ConversationWorkspaceProps {
  session: OpenPiSession
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
  fileSearchOpen: boolean
  fileFindOpen: boolean
  terminalOpen: boolean
  newTerminalRequest: number
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
  onFindOpened: () => void
  onCloseTerminal: () => void
}

export function ConversationWorkspace(props: ConversationWorkspaceProps) {
  return (
    <div class="center-col">
      <main class={`main-panel${props.openFiles.length > 0 ? ' main-panel--split' : ''}`}>
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
            <TaskWidget tasks={props.session.tasks} onDismiss={() => props.session.clearTasks()} />
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
            activeGoalText={props.session.activeGoalText}
            activeGoalStep={props.session.activeGoalStep}
            activeGoalElapsed={props.session.activeGoalElapsed}
            activeGoalProgress={props.session.activeGoalProgress}
            onSetActiveGoal={props.session.setActiveGoal}
            contextPercent={props.session.contextPercent}
            agentTps={props.session.agentRunMetrics?.tps ?? null}
            availableAgentTypes={[
              { name: 'worker', description: 'Surgical implementer' },
              { name: 'explorer', description: 'Read-only codebase cartographer' },
              { name: 'scout', description: 'External research specialist' },
              { name: 'planner', description: 'Architecture and implementation plans' },
              { name: 'reviewer', description: 'Code review and debugging' },
            ]}
          />
        </div>

        <Show when={props.openFiles.length > 0}>
          <ResizeHandle direction="horizontal" onResize={props.onResizePreview} />
          <div class="main-panel-preview" style={{ width: `${props.previewWidth}px` }}>
            <FileTabBar
              files={props.openFiles}
              activeIndex={props.activeFileIdx}
              onSelect={props.onSelectFile}
              onClose={props.onCloseFile}
            />
            <FilePreviewPane
              relativePath={props.openFiles[props.activeFileIdx] ?? ''}
              cwd={props.cwd}
              workspaceName={props.workspaceName}
              background={props.fileSearchOpen}
              findOpen={props.fileFindOpen}
              onFindOpened={props.onFindOpened}
              onAddLineComment={props.onAddLineComment}
              onClose={() => props.onCloseFile(props.activeFileIdx)}
            />
          </div>
        </Show>
      </main>

      <TerminalPanel
        cwd={props.cwd}
        isOpen={props.terminalOpen}
        newTerminalRequest={props.newTerminalRequest}
        onClose={props.onCloseTerminal}
      />
    </div>
  )
}
