import { createSignal } from 'solid-js'

interface ArchivePending {
  label: string
  paths: string[]
}

export function useAppArchive() {
  const [showArchived, setShowArchived] = createSignal(false)
  const [archivedSessions, setArchivedSessions] = createSignal<
    import('../lib/ipc').ArchivedSessionItem[]
  >([])
  const [pinnedSessions, setPinnedSessions] = createSignal<Set<string>>(new Set())
  const [archivePending, setArchivePending] = createSignal<ArchivePending | null>(null)
  const [archiveSkipConfirm, setArchiveSkipConfirm] = createSignal(false)

  const loadArchivedSessions = async () => {
    const items = await window.openpi.listArchivedSessions()
    setArchivedSessions(items)
  }

  const handleToggleArchived = () => {
    const next = !showArchived()
    setShowArchived(next)
    if (next) {
      void loadArchivedSessions()
    }
  }

  const handleUnarchiveSession = async (archivedPath: string) => {
    await window.openpi.unarchiveSessions([archivedPath])
    void loadArchivedSessions()
  }

  const handleDeleteArchivedSession = async (archivedPath: string) => {
    const confirmed = window.confirm(
      'Permanently delete this archived session?\n\nIt will be moved to the system Trash when possible.'
    )
    if (!confirmed) return

    const result = await window.openpi.deleteSessions([archivedPath])
    void loadArchivedSessions()
    if (result.failed > 0) {
      window.alert(
        'OpenPi could not delete this archived session. It may have already moved or be protected.'
      )
    }
  }

  const togglePinSession = (path: string) => {
    setPinnedSessions((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      void window.openpi.setPref('pinned_sessions', JSON.stringify([...next]))
      return next
    })
  }

  const handleArchiveSession = async (path: string) => {
    if (pinnedSessions().has(path)) {
      setPinnedSessions((prev) => {
        const next = new Set(prev)
        next.delete(path)
        void window.openpi.setPref('pinned_sessions', JSON.stringify([...next]))
        return next
      })
    }
    await window.openpi.archiveSessions([path])
  }

  const handleArchiveGroup = (label: string, paths: string[]) => {
    if (archiveSkipConfirm()) {
      void window.openpi.archiveSessions(paths)
      return
    }
    setArchivePending({ label, paths })
  }

  const handleArchiveConfirm = async (skipNext: boolean) => {
    const pending = archivePending()
    if (!pending) return
    if (skipNext) {
      setArchiveSkipConfirm(true)
      void window.openpi.setPref('archive_skip_confirm', 'true')
    }
    await window.openpi.archiveSessions(pending.paths)
    setArchivePending(null)
  }

  const handleNewSessionIn = (workspacePath: string) => {
    void window.openpi.newSession(workspacePath)
  }

  const loadPersistedPrefs = () => {
    window.openpi
      .getPref('pinned_sessions')
      .then((v) => {
        if (v) {
          try {
            setPinnedSessions(new Set(JSON.parse(v) as string[]))
          } catch {
            /* ignore */
          }
        }
      })
      .catch(() => {})

    window.openpi
      .getPref('archive_skip_confirm')
      .then((v) => {
        if (v === 'true') setArchiveSkipConfirm(true)
      })
      .catch(() => {})
  }

  return {
    showArchived,
    archivedSessions,
    pinnedSessions,
    archivePending,
    archiveSkipConfirm,
    setShowArchived,
    setArchivedSessions,
    setPinnedSessions,
    setArchivePending,
    setArchiveSkipConfirm,
    loadArchivedSessions,
    handleToggleArchived,
    handleUnarchiveSession,
    handleDeleteArchivedSession,
    togglePinSession,
    handleArchiveSession,
    handleArchiveGroup,
    handleArchiveConfirm,
    handleNewSessionIn,
    loadPersistedPrefs,
  }
}
