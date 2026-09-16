/**
 * The preview split: resize handle plus the right-hand pane showing open-file
 * previews, the agent-review pane, or git history. Owns the file-content
 * cache and the git-history data wiring — both are only used here.
 */

import { Show } from 'solid-js'
import { GitBranch, X } from 'lucide-solid'
import { useFileContentCache } from '../../hooks/useFileContentCache'
import { useGitHistoryState } from '../../hooks/useGitHistoryState'
import type { useAppFileManager } from '../../hooks/useAppFileManager'
import type { useAgentReviewChanges } from '../../hooks/useAgentReviewChanges'
import { FilePreviewPane } from '../FilePreviewPane'
import { FileTabBar } from '../FileTabBar'
import { GitHistoryTab } from '../git/GitHistoryTab'
import { ReviewPane } from '../review/ReviewPane'
import { ResizeHandle } from '../ResizeHandle'
import { isDiffPreviewTab } from '../../lib/previewTabs'

type Fm = ReturnType<typeof useAppFileManager>
type AgentReview = ReturnType<typeof useAgentReviewChanges>

export function ConversationPreviewSplit(props: {
  fm: Fm
  agentReview: AgentReview
  cwd: string
  workspaceName: string
  /** The currently open file tab ('' when none). */
  activePreviewTab: () => string
  historyActive: () => boolean
  setHistoryActive: (value: boolean) => void
  reviewSource: () => 'git' | 'last-turn'
  setReviewSource: (value: 'git' | 'last-turn') => void
  showGitHistory: boolean
  onShowGitHistoryChange: (show: boolean) => void
  onResizePreview: (delta: number) => void
  previewWidth: number
  onRequestFileSearch: () => void
  onFindOpened: () => void
}) {
  const fm = props.fm
  const fileCache = useFileContentCache()

  const gitHistoryState = useGitHistoryState({
    activeTab: () => (props.historyActive() ? ('history' as const) : ('changes' as const)),
    cwd: () => props.cwd,
    isMounted: () => true,
  })

  return (
    <>
      <ResizeHandle direction="horizontal" onResize={props.onResizePreview} />
      <div class="main-panel-preview" style={{ width: `${props.previewWidth}px` }}>
        <div class="main-panel-preview-header">
          <Show when={props.showGitHistory}>
            <div
              role="tab"
              tabIndex={0}
              aria-selected={props.historyActive()}
              class={`gh-btn${props.historyActive() ? ' gh-btn--active' : ''}`}
              title="Git History"
              onClick={() => props.setHistoryActive(true)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  props.setHistoryActive(true)
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
          <Show when={fm.openFiles().length > 0}>
            <FileTabBar
              files={fm.openFiles()}
              activeIndex={props.historyActive() ? -1 : fm.activeFileIdx()}
              onSelect={(index) => {
                props.setHistoryActive(false)
                fm.setActiveFileIdx(index)
              }}
              onClose={fm.closeFile}
              onRequestFileSearch={props.onRequestFileSearch}
            />
          </Show>
        </div>
        <Show
          when={props.historyActive()}
          fallback={
            <Show
              when={isDiffPreviewTab(props.activePreviewTab())}
              fallback={
                <FilePreviewPane
                  relativePath={props.activePreviewTab()}
                  cwd={props.cwd}
                  workspaceName={props.workspaceName}
                  background={fm.fileSearchOpen()}
                  findOpen={fm.fileFindOpen()}
                  onFindOpened={props.onFindOpened}
                  onAddLineComment={fm.addLineComment}
                  onClose={() => fm.closeFile(fm.activeFileIdx())}
                />
              }
            >
              <ReviewPane
                cwd={props.cwd}
                source={props.reviewSource()}
                onSourceChange={props.setReviewSource}
                agentReview={props.agentReview}
                requestedGitPath={fm.activeDiff()?.path ?? null}
                comments={fm.lineComments()}
                onAddComment={fm.addLineComment}
                onRemoveComment={fm.removeLineComment}
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
    </>
  )
}
