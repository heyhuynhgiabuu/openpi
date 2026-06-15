import type { GitChangedFile, GitFileDiff, GitSyncAction } from '../../lib/ipc'

export type GitPanelTab = 'changes' | 'history'

export interface GitPanelProps {
  style?: string | Record<string, string>
  cwd: string | null
  activeTab?: GitPanelTab
  hideHeader?: boolean
  onActiveTabChange?: (tab: GitPanelTab) => void
  onRequestFileSearch?: () => void
  onDiffOpen: (diff: GitFileDiff, files: GitChangedFile[], index: number) => void
  onCommitFileClick?: (commitHash: string, filePath: string, allFilePaths: string[]) => void
  onFileClick?: (relPath: string) => void
  onDragHandleMouseDown?: (event: MouseEvent) => void
  side?: 'left' | 'right'
  onBranchLabelChange?: (label: string) => void
  onSyncLabelChange?: (label: string) => void
  onSyncActionChange?: (action: GitSyncAction | null) => void
  onSyncMessageChange?: (message: string | null) => void
}
