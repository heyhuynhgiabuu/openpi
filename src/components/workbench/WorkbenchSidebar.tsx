import { Show } from 'solid-js'
import type { LeftDrawerMode } from '../BottomBar'
import { ResizeHandle } from '../ResizeHandle'
import { SessionSidebar } from '../sidebar/SessionSidebar'
import { SessionTreePanel } from '../sidebar/SessionTreePanel'
import { WorkspacePane } from '../sidebar/WorkspacePane'

interface WorkbenchSidebarProps {
  sidebarOpen: boolean
  sidebarWidth: number
  leftDrawerMode: LeftDrawerMode
  session: {
    workspaces: Parameters<typeof WorkspacePane>[0]['workspaces']
    selectedWorkspacePath: string | null
    selectWorkspace: (path: string) => Promise<void>
    openWorkspace: () => Promise<void>
    sessions: Parameters<typeof SessionSidebar>[0]['sessions']
    sessionQuery: string
    sortBy: Parameters<typeof SessionSidebar>[0]['sortBy']
    groupBy: Parameters<typeof SessionSidebar>[0]['groupBy']
    showRecent: boolean
    collapsedGroups: Set<string>
    setSessionQuery: (q: string) => void
    setSortBy: (sort: string) => void
    setGroupBy: (group: string) => void
    setShowRecent: (show: boolean) => void
    collapseAllGroups: () => void
    toggleGroup: (label: string) => void
    createNewSession: () => Promise<void>
    openExistingSession: (session: import('../../lib/ipc').SessionListItem) => Promise<void>
  }
  archive: {
    handleNewSessionIn: (workspacePath: string) => void
    handleArchiveGroup: (label: string, paths: string[]) => void
    handleArchiveSession: (path: string) => Promise<void>
    togglePinSession: (path: string) => void
    pinnedSessions: () => Set<string>
    showArchived: () => boolean
    archivedSessions: () => import('../../lib/ipc').ArchivedSessionItem[]
    handleToggleArchived: () => void
    handleUnarchiveSession: (path: string) => Promise<void>
    handleDeleteArchivedSession: (path: string) => Promise<void>
  }
  activeSessionPath: string | null
  setLeftDrawerMode: (mode: LeftDrawerMode) => void
  setSidebarOpen: (open: boolean) => void
  setScrollToMessageId: (id: string | null) => void
  scrollToMessageNonce: number
  treeRefreshVersion: number
  onResize: (delta: number) => void
}

export function WorkbenchSidebar(props: WorkbenchSidebarProps) {
  return (
    <Show when={props.sidebarOpen}>
      <Show when={props.leftDrawerMode === 'workspace'}>
        <WorkspacePane
          style={{ width: `${props.sidebarWidth}px` }}
          workspaces={props.session.workspaces}
          selectedPath={props.session.selectedWorkspacePath}
          activePath={props.activeSessionPath}
          onSelectWorkspace={(workspacePath) => {
            void props.session.selectWorkspace(workspacePath)
            props.setLeftDrawerMode('threads')
          }}
          onOpenWorkspace={props.session.openWorkspace}
          onNewSessionIn={props.archive.handleNewSessionIn}
        />
      </Show>
      <Show when={props.leftDrawerMode === 'tree'}>
        <SessionTreePanel
          style={{ width: `${props.sidebarWidth}px` }}
          sessionPath={props.activeSessionPath}
          onScrollToMessage={(entryId) => {
            props.scrollToMessageNonce++
            props.setScrollToMessageId(`${entryId}:${props.scrollToMessageNonce.toString(36)}`)
          }}
          onClose={() => props.setSidebarOpen(false)}
          refreshTrigger={props.treeRefreshVersion}
        />
      </Show>
      <Show when={props.leftDrawerMode === 'threads'}>
        <SessionSidebar
          style={{ width: `${props.sidebarWidth}px` }}
          sessions={props.session.sessions}
          workspaces={props.session.workspaces}
          selectedWorkspacePath={props.session.selectedWorkspacePath}
          activePath={props.activeSessionPath}
          query={props.session.sessionQuery}
          sortBy={props.session.sortBy}
          groupBy={props.session.groupBy}
          showRecent={props.session.showRecent}
          collapsedGroups={props.session.collapsedGroups}
          onQuery={props.session.setSessionQuery}
          onSort={props.session.setSortBy}
          onGroup={props.session.setGroupBy}
          onShowRecent={props.session.setShowRecent}
          onCollapseAll={props.session.collapseAllGroups}
          onToggleGroup={props.session.toggleGroup}
          onNewSession={props.session.createNewSession}
          onNewSessionIn={props.archive.handleNewSessionIn}
          onArchiveGroup={props.archive.handleArchiveGroup}
          onArchiveSession={(path) => void props.archive.handleArchiveSession(path)}
          onPinSession={props.archive.togglePinSession}
          pinnedSessions={props.archive.pinnedSessions()}
          showArchived={props.archive.showArchived()}
          archivedSessions={props.archive.archivedSessions()}
          onToggleArchived={props.archive.handleToggleArchived}
          onUnarchiveSession={(path) => void props.archive.handleUnarchiveSession(path)}
          onDeleteArchivedSession={(path) => void props.archive.handleDeleteArchivedSession(path)}
          onOpenSession={props.session.openExistingSession}
        />
      </Show>
      <ResizeHandle direction="horizontal" onResize={props.onResize} />
    </Show>
  )
}
