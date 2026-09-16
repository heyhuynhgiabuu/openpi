/**
 * The workbench layout: homescreen overlay, drag drop zones, git side panel
 * and right panel flanking the conversation, and the terminal drawer. Pure
 * prop threading — state and actions are owned by App's hook composition.
 */

import { Show, Suspense, lazy } from 'solid-js'
import type { ModelInfo, SessionListItem } from '../../lib/ipc'
import type { DisplayPreferences } from '../../lib/displayPreferences'
import type { useAgentReviewChanges } from '../../hooks/useAgentReviewChanges'
import type { useAppFileManager } from '../../hooks/useAppFileManager'
import type { useOpenPiSession } from '../../hooks/useOpenPiSession'
import type { useWorkbenchLayout } from '../../hooks/useWorkbenchLayout'
import type { AppSessionMemos } from '../../app/appSessionMemos'
import { GitSidePanel } from './GitSidePanel'
import { RightPanel } from './RightPanel'
import { TerminalPanel } from '../terminal/TerminalPanel'
import { ConversationWorkspace } from './ConversationWorkspace'
import { ResizeHandle } from '../ResizeHandle'

const Homescreen = lazy(() => import('../Homescreen').then((m) => ({ default: m.Homescreen })))

type Session = ReturnType<typeof useOpenPiSession>
type Fm = ReturnType<typeof useAppFileManager>
type Layout = ReturnType<typeof useWorkbenchLayout>
type AgentReview = ReturnType<typeof useAgentReviewChanges>

export function WorkbenchLayout(props: {
  session: Session
  fm: Fm
  agentReview: AgentReview
  layout: Layout
  memos: AppSessionMemos
  displayPreferences: DisplayPreferences
  scrollToMessageId: string | null
  navigateToMessage: (entryId: string) => void
  visibleModels: () => ModelInfo[]
  homescreenOpen: boolean
  setHomescreenOpen: (value: boolean) => void
  rightPanelOpen: boolean
  terminalOpen: boolean
  newTerminalRequest: number
  setTerminalOpen: (value: boolean) => void
  gitPanelOpen: boolean
  gitPanelSide: 'left' | 'right'
  gitPanelWidth: number
  gitPanelTab: 'changes'
  setGitPanelTab: (tab: 'changes') => void
  setFileSearchOpen: (value: boolean) => void
  setFileFindOpen: (value: boolean) => void
  showGitHistory: boolean
  setShowGitHistory: (value: boolean) => void
  setGitSyncLabel: (value: string) => void
  setGitSyncAction: (
    value: Parameters<NonNullable<Parameters<typeof GitSidePanel>[0]['onSyncActionChange']>>[0]
  ) => void
  setGitSyncMessage: (value: string | null) => void
  requestDeleteSession: (sessionPath: string) => void
  onConnectProvider: () => void
  onManageModels: () => void
}) {
  const fm = props.fm
  const memos = props.memos
  const layout = props.layout
  return (
    <div class="workbench" ref={layout.setWorkbenchRef}>
      {/* ── Homescreen (full-width overlay) ── */}
      <Show when={props.homescreenOpen}>
        <Suspense fallback={<div class="homescreen-loading">Loading sessions…</div>}>
          <Homescreen
            sessions={props.session.sessions}
            workspaces={props.session.workspaces}
            selectedWorkspacePath={props.session.selectedWorkspacePath}
            activeSessionPath={memos.activeSessionPath()}
            onSelectSession={(path: string) =>
              void props.session.openExistingSession({ path } as SessionListItem)
            }
            onNewSession={() => void props.session.createNewSession()}
            onSelectWorkspace={(path: string) => void props.session.selectWorkspace(path)}
            onOpenWorkspace={() => void props.session.openWorkspace()}
            onDeleteSession={props.requestDeleteSession}
            onClose={() => props.setHomescreenOpen(false)}
          />
        </Suspense>
      </Show>

      {/* ── Normal workspace (hidden when homescreen is open) ── */}
      <Show when={!props.homescreenOpen}>
        {/* Drop zones — shown while git panel is being dragged */}
        <Show when={layout.isDraggingGit()}>
          <div
            class={`panel-drop-zone panel-drop-zone--left${layout.dropSide() === 'left' ? ' is-over' : ''}`}
          >
            <span class="panel-drop-zone-hint">← Left of main</span>
          </div>
          <div
            class={`panel-drop-zone panel-drop-zone--right${layout.dropSide() === 'right' ? ' is-over' : ''}`}
          >
            <span class="panel-drop-zone-hint">Right of main →</span>
          </div>
        </Show>

        <div class="workbench-main">
          <GitSidePanel
            visible={props.gitPanelOpen && props.gitPanelSide === 'left'}
            side="left"
            cwd={memos.cwd()}
            width={props.gitPanelWidth}
            activeTab={props.gitPanelTab}
            onActiveTabChange={props.setGitPanelTab}
            onDragStart={layout.startGitDrag}
            onResize={layout.resizeGitPanel}
            onRequestFileSearch={() => props.setFileSearchOpen(true)}
            onDiffOpen={fm.handleDiffOpen}
            onCommitFileClick={fm.openCommitDiff}
            onFileClick={fm.openFile}
            onSyncLabelChange={props.setGitSyncLabel}
            onSyncActionChange={props.setGitSyncAction}
            onSyncMessageChange={props.setGitSyncMessage}
            onOpenHistory={() => props.setShowGitHistory(true)}
          />

          <ConversationWorkspace
            session={props.session}
            agentReview={props.agentReview}
            fm={fm}
            cwd={memos.cwd()}
            workspaceName={memos.workspaceName()}
            activeSessionPath={memos.activeSessionPath()}
            messages={memos.conversationMessages()}
            isStreaming={memos.conversationStreaming()}
            displayPreferences={props.displayPreferences}
            scrollToMessageId={props.scrollToMessageId}
            onNavigateToMessage={props.navigateToMessage}
            onCancelTask={props.session.cancelTask}
            branchLeafId={props.session.branchLeafId()}
            treeVersion={props.session.treeVersion()}
            onBranchFrom={props.session.navigateTree}
            showRemoteSessionBar={memos.showRemoteSessionBar()}
            promptHistory={memos.promptHistory()}
            visibleModels={props.visibleModels()}
            previewWidth={layout.previewWidth()}
            showGitHistory={props.showGitHistory}
            onShowGitHistoryChange={props.setShowGitHistory}
            onConnectProvider={props.onConnectProvider}
            onManageModels={props.onManageModels}
            onResizePreview={layout.resizePreview}
            onRequestFileSearch={() => props.setFileSearchOpen(true)}
            onFindOpened={() => props.setFileFindOpen(false)}
          />

          <Show when={props.rightPanelOpen}>
            <ResizeHandle direction="horizontal" onResize={layout.resizeRightPanel} />
            <RightPanel
              visible
              cwd={memos.cwd()}
              width={props.gitPanelWidth}
              onResize={layout.resizeRightPanel}
              changeCount={
                props.session.gitStats
                  ? (props.session.gitStats.changed ?? 0) +
                      (props.session.gitStats.untracked ?? 0) || null
                  : null
              }
              onDiffOpen={fm.handleDiffOpen}
              onCommitFileClick={fm.openCommitDiff}
              onFileClick={fm.openFile}
              onFileDeleted={fm.closeDeletedFilePreviews}
              onFileRenamed={fm.renameFileInPreviews}
              onSyncLabelChange={props.setGitSyncLabel}
              onSyncActionChange={props.setGitSyncAction}
              onSyncMessageChange={props.setGitSyncMessage}
              onOpenHistory={() => props.setShowGitHistory(true)}
            />
          </Show>
        </div>

        <TerminalPanel
          cwd={memos.cwd()}
          isOpen={props.terminalOpen}
          newTerminalRequest={props.newTerminalRequest}
          onClose={() => props.setTerminalOpen(false)}
        />
      </Show>
    </div>
  )
}
