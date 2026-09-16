/**
 * useOpenPiSession — SolidJS reactive session hook.
 *
 * Signals are exposed as getters (consumers write `session.ready`, not
 * `session.ready()`) so JSX/createEffect reads stay reactively tracked.
 * Behavior blocks live in ./session/: sessionEventPipe, sessionActions,
 * sessionIpcWiring, useTaskHistoryPolling.
 */
import { createMemo, createSignal } from 'solid-js'
import type { ModelInfo, SessionReady, SessionStats, WorkspaceSummaryInfo } from '../lib/ipc'
import { buildSessionPromptText } from '../lib/sessionPrompt'
import { isSubSessionPath } from '../lib/subSessionNavigation'
import type { TaskHistoryEntry } from '../lib/taskHistory'
import type { Message } from '../types/session'
import { createSessionNavigation, type ParentStackEntry } from './sessionNavigation'
import { createSessionActions } from './session/sessionActions'
import { createSessionEventHandle, type SessionPipeRefs } from './session/sessionEventPipe'
import { registerRefreshEffects, registerSessionIpc } from './session/sessionIpcWiring'
import { createTaskCardResolvers } from './session/taskCardResolvers'
import { applyGetters } from './session/getters'
import { useTaskHistoryPolling } from './session/useTaskHistoryPolling'
import { useAgentRunMetrics } from './useAgentRunMetrics'
import { useExtensionTrackers } from './useExtensionTrackers'

export { isSubSessionPath }

import type { AwaitingPrompt, QueueMode } from './session/sessionEventPipe'
export type { AwaitingPrompt, QueueMode } from './session/sessionEventPipe'

import { useRemoteSessionSync } from './useRemoteSessionSync'
import { useSessionHistory } from './useSessionHistory'
import { useSessionIndex } from './useSessionIndex'
import { useSubagentFileTracker } from './useSubagentFileTracker'

export { buildSessionPromptText }

export function useOpenPiSession() {
  // ── Core session state ────────────────────────────────────────────────────
  const [ready, setReady] = createSignal<SessionReady | null>(null)
  const [messages, setMessages] = createSignal<Message[]>([])
  const [isStreaming, setIsStreaming] = createSignal(false)
  const [isShellRunning, setIsShellRunning] = createSignal(false)
  // Set by Pi 0.85 ui_prompt_start/end events: the agent is blocked on a
  // ctx.ui prompt instead of streaming ("working" vs "awaiting response").
  const [awaitingPrompt, setAwaitingPrompt] = createSignal<AwaitingPrompt | null>(null)
  const [input, setInput] = createSignal('')
  const [models, setModels] = createSignal<ModelInfo[]>([])
  const [error, setError] = createSignal<string | null>(null)
  const [queueMode, setQueueMode] = createSignal<QueueMode>('prompt')
  const [parentStack, setParentStack] = createSignal<Array<ParentStackEntry>>([])
  const [taskHistory, setTaskHistory] = createSignal<TaskHistoryEntry[]>([])
  const isSubSession = createMemo<boolean>(() => isSubSessionPath(ready()?.sessionFile))
  const [currentModel, setCurrentModel] = createSignal<ModelInfo | null>(null)
  const [thinkingLevel, setThinkingLevelState] = createSignal<string>('medium')
  const sessionIndex = useSessionIndex(() => ready()?.cwd ?? null)
  const [gitBranch, setGitBranch] = createSignal<string | null>(null)
  const [workspaceSummary, setWorkspaceSummary] = createSignal<WorkspaceSummaryInfo | null>(null)
  const [gitStats, setGitStats] = createSignal<{
    added: number
    removed: number
    untracked: number
    changed: number
  } | null>(null)
  const [steeringQueue, setSteeringQueue] = createSignal<string[]>([])
  const [followUpQueue, setFollowUpQueue] = createSignal<string[]>([])
  const [sessionName, setSessionNameState] = createSignal<string | null>(null)
  const [contextPercent, setContextPercent] = createSignal<number | null>(null)
  const [sessionStats, setSessionStats] = createSignal<SessionStats | null>(null)
  // ── Extension trackers (ask / subagents) ──────────────────────────
  const trackers = useExtensionTrackers()
  const subagentFiles = useSubagentFileTracker()
  const agentRunMetrics = useAgentRunMetrics()
  // Pi's branch switch moves the leaf without writing an entry; remember where
  // it landed (the file's last line is stale until the next append).
  const [branchLeafId, setBranchLeafId] = createSignal<string | null>(null)
  // Bumped on entry-appending events, so file-backed views (session map) can
  // refresh while open. Not per token.
  const [treeVersion, setTreeVersion] = createSignal(0)
  const sessionHistory = useSessionHistory({
    setMessages,
    setError,
    getLeafId: branchLeafId,
  })
  const remoteSync = useRemoteSessionSync({
    isStreaming,
    isReady: () => ready() !== null,
    setError,
  })

  // ── Refs — plain variables assigned via ref= callbacks ──────────────────
  const refs: SessionPipeRefs & {
    textareaEl: HTMLTextAreaElement | undefined
    bottomEl: HTMLDivElement | undefined
  } = {
    justSentPrompt: false,
    currentModelName: null,
    currentTurnStartMs: null,
    textareaEl: undefined,
    bottomEl: undefined,
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  const refreshContextUsage = async () => {
    try {
      const stats = await window.openpi.getSessionStats()
      setContextPercent(stats.contextUsagePercent)
      setSessionStats(stats)
    } catch {
      /* non-fatal */
    }
  }

  const handleEvent = createSessionEventHandle({
    refs,
    refreshContextUsage,
    remoteSync,
    agentRunMetrics,
    trackers,
    setIsStreaming,
    setAwaitingPrompt,
    setQueueMode,
    setSteeringQueue,
    setFollowUpQueue,
    setSessionNameState,
    setMessages,
    setBranchLeafId,
    setTreeVersion,
  })

  const actions = createSessionActions({
    refs,
    input,
    setInput,
    ready,
    queueMode,
    isShellRunning,
    setIsShellRunning,
    setCurrentModel,
    setModels,
    setError,
    setMessages,
    setThinkingLevelState,
    setSessionNameState,
    setBranchLeafId,
    refreshContextUsage,
    remoteSync,
    sessionHistory,
  })

  // ── Effects ────────────────────────────────────────────────────────────────
  const resolvers = createTaskCardResolvers({
    trackers,
    taskHistory,
  })

  useTaskHistoryPolling(ready, setTaskHistory)

  registerRefreshEffects({
    ready,
    currentModel,
    setCurrentModel: (model) => setCurrentModel(model),
    setModels,
    setTextareaFocus: () => refs.textareaEl?.focus(),
    sessionIndex,
  })

  // ── IPC subscriptions (mounted once, cleaned up on unmount) ──────────────
  registerSessionIpc({
    refs,
    handleEvent,
    refreshContextUsage,
    remoteSync,
    sessionHistory,
    sessionIndex,
    trackers,
    getReady: ready,
    setReady,
    setMessages,
    setError,
    setSteeringQueue,
    setFollowUpQueue,
    setAwaitingPrompt: setAwaitingPrompt as (value: null) => void,
    setSessionNameState,
    setCurrentModel,
    setThinkingLevelState,
    setIsStreaming,
    setBranchLeafId,
    setContextPercent,
    setWorkspaceSummary,
    setGitBranch,
    setGitStats,
  })

  // ── Actions ───────────────────────────────────────────────────────────────

  const { openWorkspace, openExistingSession, openSubSession, popToParent, createNewSession } =
    createSessionNavigation({
      api: window.openpi,
      getReady: ready,
      getParentStack: parentStack,
      setParentStack,
      setError,
      sessionIndex,
    })

  // ── Return (getter-based: callers write session.ready, not session.ready()) ──
  // Getters are DEFINED on the returned object (never spread a getter-bearing
  // object — spread snapshots getter values and freezes them).
  return applyGetters(
    {
      dismissTaskNotification: () => trackers.dismissTaskNotification(),

      resolveTaskIdForCard: resolvers.resolveTaskIdForCard,
      resolveTaskStatusForTaskId: resolvers.resolveTaskStatusForTaskId,
      clearArtifacts: () => subagentFiles.clear(),

      // Ref setters — pass as `ref={session.setBottomRef}` in JSX:
      setBottomRef: (el: HTMLDivElement) => {
        refs.bottomEl = el
      },
      // Raw signal accessors — consumers call them (session.branchLeafId()).
      branchLeafId,
      treeVersion,
      setTextareaRef: (el: HTMLTextAreaElement) => {
        refs.textareaEl = el
      },

      // Setters
      setInput,
      setError,
      setQueueMode,
      setSessionQuery: sessionIndex.setSessionQuery,
      setSortBy: sessionIndex.setSortBy,
      setGroupBy: sessionIndex.setGroupBy,
      setShowRecent: sessionIndex.setShowRecent,

      // Navigation + actions
      openWorkspace,
      openExistingSession,
      openSubSession,
      popToParent,
      createNewSession,
      selectWorkspace: sessionIndex.selectWorkspace,
      loadWorkspacePreview: sessionIndex.loadWorkspacePreview,
      loadOlderSessionMessages: sessionHistory.loadOlderSessionMessages,
      ...actions,
      clearTasks: () => {
        trackers.clearAll()
      },

      // Sub-session navigation (raw accessors — consumers call them)
      parentStack,
      isSubSession,
    },
    {
      ready,
      messages,
      isStreaming,
      awaitingPrompt,
      agentTps: agentRunMetrics.tps,
      runUsage: agentRunMetrics.usage,
      isShellRunning,
      input,
      models,
      error,
      queueMode,
      currentModel,
      workspaces: sessionIndex.workspaces,
      sessions: sessionIndex.sessions,
      selectedWorkspacePath: sessionIndex.selectedWorkspacePath,
      sessionQuery: sessionIndex.sessionQuery,
      sortBy: sessionIndex.sortBy,
      groupBy: sessionIndex.groupBy,
      showRecent: sessionIndex.showRecent,
      gitBranch,
      workspaceSummary,
      gitStats,
      steeringQueue,
      followUpQueue,
      remoteSessionStatus: remoteSync.remoteSessionStatus,
      remoteSessionMessages: remoteSync.remoteSessionMessages,
      remoteSessionUpdatedAt: remoteSync.remoteSessionUpdatedAt,
      localActivityAt: remoteSync.localActivityAt,
      sessionName,
      contextPercent,
      sessionStats,
      thinkingLevel,
      hasMoreHistoryBefore: sessionHistory.hasMoreHistoryBefore,
      isLoadingOlderHistory: sessionHistory.isLoadingOlderHistory,
      tasks: trackers.tasks,
      taskNotification: trackers.taskNotification,
      artifacts: subagentFiles.artifacts,
      todoFiles: subagentFiles.todoFiles,
    }
  )
}
