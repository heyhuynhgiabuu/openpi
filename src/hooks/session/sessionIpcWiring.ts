/**
 * IPC wiring for the session hook: subscribes to sidecar events, session
 * ready/error, index updates, and git status changes; resets conversation
 * state when a new session becomes ready. Registration must run inside the
 * hook's reactive owner (uses onMount).
 */

import { batch, createEffect, on, onCleanup, onMount } from 'solid-js'
import type { ModelInfo, SessionEvent, SessionReady, WorkspaceSummaryInfo } from '../../lib/ipc'
import type { Message } from '../../types/session'
import type { useRemoteSessionSync } from '../useRemoteSessionSync'
import type { useSessionHistory } from '../useSessionHistory'
import type { useSessionIndex } from '../useSessionIndex'
import type { useExtensionTrackers } from '../useExtensionTrackers'
import type { SessionPipeRefs } from './sessionEventPipe'

export interface SessionIpcWiringDeps {
  refs: SessionPipeRefs
  handleEvent: (event: SessionEvent) => void
  refreshContextUsage: () => Promise<void>
  remoteSync: Pick<
    ReturnType<typeof useRemoteSessionSync>,
    'handleRemoteSessionStatus' | 'handleRemoteSessionUpdate'
  >
  sessionHistory: Pick<ReturnType<typeof useSessionHistory>, 'reset' | 'loadInitialMessages'>
  sessionIndex: ReturnType<typeof useSessionIndex>
  trackers: Pick<ReturnType<typeof useExtensionTrackers>, 'clearAll'>
  getReady: () => SessionReady | null
  setReady: (value: SessionReady) => void
  setMessages: (update: (previous: Message[]) => Message[]) => void
  setError: (value: string | null) => void
  setSteeringQueue: (value: string[]) => void
  setFollowUpQueue: (value: string[]) => void
  setAwaitingPrompt: (value: null) => void
  setSessionNameState: (value: string | null) => void
  setCurrentModel: (value: SessionReady['model']) => void
  setThinkingLevelState: (value: string) => void
  setIsStreaming: (value: boolean) => void
  setBranchLeafId: (value: string | null) => void
  setContextPercent: (value: number | null) => void
  setWorkspaceSummary: (value: WorkspaceSummaryInfo | null) => void
  setGitBranch: (value: string | null) => void
  setGitStats: (
    value: {
      added: number
      removed: number
      untracked: number
      changed: number
    } | null
  ) => void
}

/** Refresh effects: models on session-ready, task-history polling, and the
 * session-index refetch on filter changes. */
export function registerRefreshEffects(deps: {
  ready: () => SessionReady | null
  currentModel: () => ModelInfo | null
  setCurrentModel: (value: ModelInfo) => void
  setModels: (value: ModelInfo[]) => void
  setTextareaFocus: () => void
  sessionIndex: ReturnType<typeof useSessionIndex>
}): void {
  createEffect(
    on(deps.ready, (r) => {
      if (!r) return
      if (r.model) {
        window.openpi
          .getModels()
          .then((availableModels) => {
            deps.setModels(availableModels)
            if (!deps.currentModel() && availableModels.length) {
              deps.setCurrentModel(availableModels[0])
            }
          })
          .catch(() => {})
      }

      // Focus composer when a session opens
      deps.setTextareaFocus()
    })
  )

  createEffect(
    on(
      [
        deps.sessionIndex.sessionQuery,
        deps.sessionIndex.sortBy,
        deps.sessionIndex.groupBy,
        deps.sessionIndex.showRecent,
      ] as const,
      () => {
        void deps.sessionIndex.loadSessionIndex()
      },
      { defer: true }
    )
  )
}

export function registerSessionIpc(deps: SessionIpcWiringDeps): void {
  onMount(() => {
    const unsubs: Array<() => void> = []

    unsubs.push(window.openpi.onSessionEvent(deps.handleEvent))
    unsubs.push(window.openpi.onRemoteSessionStatus(deps.remoteSync.handleRemoteSessionStatus))
    unsubs.push(window.openpi.onRemoteSessionUpdate(deps.remoteSync.handleRemoteSessionUpdate))

    unsubs.push(
      window.openpi.onSessionReady((payload) => {
        batch(() => {
          deps.setReady(payload)
          deps.sessionIndex.setSelectedWorkspacePath(payload.cwd)
          deps.setMessages(() => [])
          deps.setError(null)
          deps.setSteeringQueue([])
          deps.setFollowUpQueue([])
          deps.setAwaitingPrompt(null)
          deps.setSessionNameState(payload.sessionName ?? null)
          // Clear extension trackers on new session
          deps.trackers.clearAll()
          if (payload.model) {
            deps.setCurrentModel(payload.model)
            deps.refs.currentModelName = payload.model.name
          }
          if (payload.thinkingLevel) deps.setThinkingLevelState(payload.thinkingLevel)
          // A leaf from the previous session must not leak into this one.
          deps.setBranchLeafId(null)
          deps.sessionHistory.reset(payload.sessionFile ?? null)
          deps.setContextPercent(null)
          deps.setWorkspaceSummary(null)
        })

        const summaryCwd = payload.cwd
        window.openpi
          .getWorkspaceSummary(summaryCwd)
          .then((info) => {
            if (deps.getReady()?.cwd !== summaryCwd) return
            deps.setWorkspaceSummary(info)
            deps.setGitBranch(info.branch)
          })
          .catch(() => {
            if (deps.getReady()?.cwd !== summaryCwd) return
            deps.setWorkspaceSummary(null)
            deps.setGitBranch(null)
          })

        if (payload.sessionFile) {
          deps.sessionHistory.loadInitialMessages(payload.sessionFile)
        }

        void deps.sessionIndex.loadSessionIndex(payload.cwd)
        void deps.refreshContextUsage()
      })
    )

    unsubs.push(
      window.openpi.onSessionError((err) => {
        batch(() => {
          deps.setError(err.message)
          deps.setIsStreaming(false)
        })
      })
    )

    unsubs.push(
      window.openpi.onSessionIndexUpdated(() => {
        void deps.sessionIndex.loadSessionIndex()
      })
    )

    unsubs.push(
      window.openpi.git.onStatusChanged((s) => {
        deps.setGitStats({
          added: s.totalAdded,
          removed: s.totalRemoved,
          untracked: s.files.filter((f) => f.status === '?').length,
          changed: s.files.length,
        })
      })
    )

    // Initial load
    void deps.sessionIndex.loadSessionIndex()

    onCleanup(() => {
      for (const u of unsubs) u()
    })
  })
}
