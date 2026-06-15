import type { GitChangedFile, GitSyncAction } from '../../lib/ipc'
import { GitAgentBanner } from './GitAgentBanner'
import { GitChangesList } from './GitChangesList'
import { GitCommitArea } from './GitCommitArea'

interface AgentChangedFiles {
  count: number
  files: GitChangedFile[]
}

interface GitChangesTabProps {
  agentChangedFiles: AgentChangedFiles | null
  showingAgentFiles: boolean
  statusLoaded: boolean
  hasUpstream: boolean
  totalChanged: number
  stageableFiles: GitChangedFile[]
  pinnedAgentFiles: GitChangedFile[]
  conflictFiles: GitChangedFile[]
  stagedFiles: GitChangedFile[]
  unstagedFiles: GitChangedFile[]
  untrackedFiles: GitChangedFile[]
  loadingDiff: string | null
  commitMessage: string
  isCommitting: boolean
  isGeneratingMessage: boolean
  commitOptionsOpen: boolean
  commitAmend: boolean
  commitSignoff: boolean
  commitError: string | null
  syncingAction: GitSyncAction | null
  syncBlocked: boolean
  onReviewAgentChanges: () => void
  onDismissAgentChanges: () => void
  onStageAll: () => void
  onUnstageAll: () => void
  onShowAllChanges: () => void
  onFileClick: (file: GitChangedFile) => void
  onStageToggle: (file: GitChangedFile, event: Event) => void
  onCommitMessageChange: (message: string) => void
  onGenerateCommitMessage: () => void
  onCommit: (push: boolean) => void
  onCommitOptionsOpenChange: (open: boolean) => void
  onCommitAmendChange: (value: boolean) => void
  onCommitSignoffChange: (value: boolean) => void
  onSync: (action: GitSyncAction) => void
  onOpenHistory?: () => void
}

export function GitChangesTab(props: GitChangesTabProps) {
  return (
    <div class="git-panel-body">
      <GitAgentBanner
        agentChangedFiles={props.agentChangedFiles}
        showingAgentFiles={props.showingAgentFiles}
        onReview={props.onReviewAgentChanges}
        onDismiss={props.onDismissAgentChanges}
      />
      <div class="git-changes-scroll">
        <GitChangesList
          statusLoaded={props.statusLoaded}
          totalChanged={props.totalChanged}
          showingAgentFiles={props.showingAgentFiles}
          stageableFiles={props.stageableFiles}
          pinnedAgentFiles={props.pinnedAgentFiles}
          conflictFiles={props.conflictFiles}
          stagedFiles={props.stagedFiles}
          unstagedFiles={props.unstagedFiles}
          untrackedFiles={props.untrackedFiles}
          loadingDiff={props.loadingDiff}
          onStageAll={props.onStageAll}
          onUnstageAll={props.onUnstageAll}
          onShowAllChanges={props.onShowAllChanges}
          onFileClick={props.onFileClick}
          onStageToggle={props.onStageToggle}
        />
      </div>

      <GitCommitArea
        commitMessage={props.commitMessage}
        isCommitting={props.isCommitting}
        isGeneratingMessage={props.isGeneratingMessage}
        commitOptionsOpen={props.commitOptionsOpen}
        commitAmend={props.commitAmend}
        commitSignoff={props.commitSignoff}
        commitError={props.commitError}
        syncingAction={props.syncingAction}
        syncBlocked={props.syncBlocked}
        hasUpstream={props.hasUpstream}
        totalChanged={props.totalChanged}
        hasStagedFiles={props.stagedFiles.length > 0}
        onCommitMessageChange={props.onCommitMessageChange}
        onCommit={props.onCommit}
        onGenerateCommitMessage={props.onGenerateCommitMessage}
        onCommitOptionsOpenChange={props.onCommitOptionsOpenChange}
        onCommitAmendChange={props.onCommitAmendChange}
        onCommitSignoffChange={props.onCommitSignoffChange}
        onSync={props.onSync}
        onOpenHistory={props.onOpenHistory}
      />
    </div>
  )
}
