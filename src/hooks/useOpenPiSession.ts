/**
 * useOpenPiSession — SolidJS reactive session hook.
 *
 * Migration from React:
 *   useState      → createSignal (accessed via getters so callers use session.ready, not session.ready())
 *   useEffect     → onMount + createEffect(on(...)) + onCleanup
 *   useCallback   → plain functions (no deps array needed — SolidJS components execute once)
 *   useMemo       → createMemo
 *   useRef        → let variable (assigned via ref= callback)
 *   startTransition → removed (batch() used where needed)
 *
 * Getter pattern: each signal is exposed as a JS getter so consumers can write
 * `session.ready` (same as before) while still getting fine-grained reactivity
 * tracking when accessed from JSX or createEffect.
 */
import { batch, createEffect, createSignal, on, onCleanup, onMount } from 'solid-js'
import {
  type AskState,
  AskTracker,
  SubagentTracker,
  TaskTracker,
  type TrackedAgent,
  type TrackedTask,
} from '../lib/extensionTrackers'
import type {
  BashExecutionResult,
  GoalUpdate,
  ModelInfo,
  PlanUpdate,
  RemoteSessionUpdate,
  SessionEvent,
  SessionListItem,
  SessionListOptions,
  SessionReady,
  WorkspaceInfo,
  WorkspaceSummaryInfo,
} from '../lib/ipc'
import { applySessionEvent } from '../lib/sessionEvents'
import { buildSessionPromptPayload, buildSessionPromptText } from '../lib/sessionPrompt'
import { groupSessions } from '../lib/sessionView'
import type { GroupMode, Message, SortMode } from '../types/session'

export type QueueMode = 'prompt' | 'steer' | 'followup'

const HISTORY_PAGE_LIMIT = 200

export { buildSessionPromptText }

export function useOpenPiSession() {
  // ── Core session state ────────────────────────────────────────────────────
  const [ready, setReady] = createSignal<SessionReady | null>(null)
  const [messages, setMessages] = createSignal<Message[]>([])
  const [isStreaming, setIsStreaming] = createSignal(false)
  const [isShellRunning, setIsShellRunning] = createSignal(false)
  const [input, setInput] = createSignal('')
  const [models, setModels] = createSignal<ModelInfo[]>([])
  const [error, setError] = createSignal<string | null>(null)
  const [queueMode, setQueueMode] = createSignal<QueueMode>('prompt')
  // Tracks whether the user just sent a fresh prompt (not a steer/followup).
  // Used to limit auto-steer activation to explicit user-initiated prompts only,
  // so intermediate agent_start events (e.g. after steer delivery) don't override
  // a mode the user intentionally set mid-stream.
  let _justSentPrompt = false
  const [currentModel, setCurrentModel] = createSignal<ModelInfo | null>(null)
  const [thinkingLevel, setThinkingLevelState] = createSignal<string>('medium')
  const [workspaces, setWorkspaces] = createSignal<WorkspaceInfo[]>([])
  const [sessions, setSessions] = createSignal<SessionListItem[]>([])
  const [selectedWorkspacePath, setSelectedWorkspacePath] = createSignal<string | null>(null)
  const [sessionQuery, setSessionQuery] = createSignal('')
  const [sortBy, setSortBy] = createSignal<SortMode>('created')
  const [groupBy, setGroupBy] = createSignal<GroupMode>('workspace')
  const [showRecent, setShowRecent] = createSignal(true)
  const [collapsedGroups, setCollapsedGroups] = createSignal<Set<string>>(new Set())
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
  const [hasMoreHistoryBefore, setHasMoreHistoryBefore] = createSignal(false)
  const [historyBeforeEntryId, setHistoryBeforeEntryId] = createSignal<string | null>(null)
  const [isLoadingOlderHistory, setIsLoadingOlderHistory] = createSignal(false)

  // ── Goal state ────────────────────────────────────────────────────────────
  const [activeGoalText, setActiveGoalText] = createSignal<string | null>(null)

  // ── Extension trackers (tasks / ask / subagents) ──────────────────────────
  const _taskTracker = new TaskTracker()
  const _askTracker = new AskTracker()
  const _subagentTracker = new SubagentTracker()
  const [tasks, setTasks] = createSignal<TrackedTask[]>([])
  const [askState, setAskState] = createSignal<AskState | null>(null)
  const [agents, setAgents] = createSignal<TrackedAgent[]>([])
  const [agentRunMetrics, setAgentRunMetrics] = createSignal<{
    elapsedMs: number
    output: number
    tps: number
  } | null>(null)

  // ── Subagent completion notification ─────────────────────────────────────
  const [subagentNotification, setSubagentNotification] = createSignal<{
    id: string
    description: string
    status: 'completed' | 'failed'
    result?: string
  } | null>(null)
  const _notifiedAgentIds = new Set<string>()

  // ── Remote agent status (Pi TUI sync bridge) ─────────────────────────────
  const [remoteSessionStatus, setRemoteSessionStatus] = createSignal<{
    app: string
    status: string
    pid: number
    workspace?: string
    sessionFile?: string | null
  } | null>(null)
  const [remoteSessionUpdate, setRemoteSessionUpdate] = createSignal<RemoteSessionUpdate | null>(
    null
  )
  const [goalUpdate, setGoalUpdate] = createSignal<GoalUpdate | null>(null)
  const [planUpdate, setPlanUpdate] = createSignal<PlanUpdate | null>(null)

  // Live elapsed offset: ticks up every second while the agent is streaming
  const [goalElapsedOffset, setGoalElapsedOffset] = createSignal(0)
  createEffect(() => {
    if (isStreaming() && activeGoalText()) {
      const id = setInterval(() => {
        setGoalElapsedOffset((o) => o + 1)
      }, 1000)
      onCleanup(() => clearInterval(id))
    } else {
      setGoalElapsedOffset(0)
    }
  })
  const [localActivityAt, setLocalActivityAt] = createSignal(0)

  const markLocalActivity = () => {
    setLocalActivityAt(Date.now())
    setRemoteSessionStatus(null)
    setRemoteSessionUpdate(null)
  }

  // ── Refs — plain variables assigned via SolidJS ref= callback ────────────
  let _bottomEl: HTMLDivElement | undefined
  let textareaEl: HTMLTextAreaElement | undefined
  let latestSessionFile: string | null = null
  let currentModelName: string | null = null
  let currentTurnStartMs: number | null = null
  // ── Agent-run wall-clock tracking (for accurate TPS) ─────────────────
  let _agentStartWallMs: number | null = null

  // ── Derived ───────────────────────────────────────────────────────────────
  // (contextPercent is already a signal — no memo wrapper needed)

  // ── Helpers ───────────────────────────────────────────────────────────────
  const selectedWorkspaceForQuery = () => selectedWorkspacePath() ?? ready()?.cwd ?? null

  const loadSessionIndex = async (workspaceOverride?: string | null) => {
    const workspacePath = workspaceOverride ?? selectedWorkspaceForQuery()
    const options: SessionListOptions = {
      query: sessionQuery(),
      sortBy: sortBy(),
      groupBy: groupBy(),
      showRecent: showRecent(),
      recentDays: 30,
      workspacePath: workspacePath ?? undefined,
    }
    const [workspaceList, sessionList] = await Promise.all([
      window.openpi.getWorkspaces(),
      window.openpi.getSessions(options),
    ])
    batch(() => {
      setWorkspaces(workspaceList)
      setSessions(sessionList)
      if (!selectedWorkspacePath()) {
        const fallback = workspacePath ?? workspaceList[0]?.path ?? null
        if (fallback) setSelectedWorkspacePath(fallback)
      }
    })
  }

  const refreshContextUsage = async () => {
    try {
      const stats = await window.openpi.getSessionStats()
      setContextPercent(stats.contextUsagePercent)
    } catch {
      /* non-fatal */
    }
  }

  const handleEvent = (event: SessionEvent) => {
    if (event.type === 'agent_start') {
      setIsStreaming(true)
      markLocalActivity()
      // Reset wall-clock TPS tracking
      _agentStartWallMs = Date.now()
      setAgentRunMetrics(null)
      // Auto-activate steer mode ONLY when the user explicitly sent a fresh
      // prompt — not on every agent_start (e.g. intermediate restarts after
      // a steer delivery). This prevents overriding a mode the user set
      // intentionally while the agent was already running.
      if (_justSentPrompt) {
        setQueueMode('steer')
        _justSentPrompt = false
      }
    }
    if (event.type === 'turn_start') {
      const e = event as { timestamp?: number }
      currentTurnStartMs = e.timestamp ?? Date.now()
    }
    if (event.type === 'agent_end') {
      setIsStreaming(false)
      setQueueMode('prompt')
      currentTurnStartMs = null
      void refreshContextUsage()
      // Clear finished subagents on session end; keep tasks/ask across agent turns
      _subagentTracker.clearFinished()
      setAgents(_subagentTracker.snapshot())

      // Compute wall-clock TPS using agent_end event.messages (same approach as Pi's tps.ts)
      if (_agentStartWallMs !== null) {
        const elapsedMs = Date.now() - _agentStartWallMs
        const msgs = (event as Record<string, unknown>).messages
        if (elapsedMs > 0 && Array.isArray(msgs)) {
          let output = 0
          for (const m of msgs) {
            if ((m as Record<string, unknown>).role === 'assistant') {
              const usage = (m as Record<string, unknown>).usage as
                | Record<string, unknown>
                | undefined
              if (usage && typeof usage.output === 'number') {
                output += usage.output
              }
            }
          }
          if (output > 0) {
            setAgentRunMetrics({
              elapsedMs,
              output,
              tps: output / (elapsedMs / 1000),
            })
          }
        }
        _agentStartWallMs = null
      }
    }

    // ── Extension tracker dispatch ───────────────────────────────────────────
    if (event.type === 'openpi_subagent_update') {
      if (_subagentTracker.onSubagentUpdate(event)) setAgents(_subagentTracker.snapshot())
      // Proactive notification when a background agent completes or fails
      const subEvent = event as {
        agent_id?: string
        status?: string
        background?: boolean
        description?: string
        result?: string
      }
      const agentStatus = subEvent.status
      if (
        subEvent.agent_id &&
        !_notifiedAgentIds.has(subEvent.agent_id) &&
        (agentStatus === 'completed' || agentStatus === 'failed')
      ) {
        _notifiedAgentIds.add(subEvent.agent_id)
        setSubagentNotification({
          id: subEvent.agent_id,
          description: String(subEvent.description ?? 'Agent task'),
          status: agentStatus,
          result: subEvent.result,
        })
        // Auto-dismiss after 8 seconds
        setTimeout(() => setSubagentNotification(null), 8000)
      }
      return
    }
    if (event.type === 'tool_execution_start') {
      const e = event as { toolCallId?: string; toolName?: string; args?: Record<string, unknown> }
      const id = e.toolCallId ?? ''
      const name = e.toolName ?? ''
      const args = e.args ?? {}
      let changed = false
      changed = _taskTracker.onToolStart(id, name, args) || changed
      changed = _askTracker.onToolStart(id, name, args) || changed
      changed = _subagentTracker.onToolStart(id, name, args) || changed
      if (changed) {
        batch(() => {
          setTasks(_taskTracker.snapshot())
          setAskState(_askTracker.snapshot())
          setAgents(_subagentTracker.snapshot())
        })
      }
    }
    if (event.type === 'tool_execution_end') {
      const e = event as {
        toolCallId?: string
        toolName?: string
        result?: unknown
        isError?: boolean
      }
      const id = e.toolCallId ?? ''
      const name = e.toolName ?? ''
      const result = typeof e.result === 'string' ? e.result : JSON.stringify(e.result ?? '')
      const isError = Boolean(e.isError)
      let changed = false
      changed = _taskTracker.onToolEnd(id, name, result) || changed
      changed = _askTracker.onToolEnd(id, name, isError) || changed
      changed = _subagentTracker.onToolEnd(id, name, result, isError) || changed
      if (changed) {
        batch(() => {
          setTasks(_taskTracker.snapshot())
          setAskState(_askTracker.snapshot())
          setAgents(_subagentTracker.snapshot())
        })
      }
    }

    if (event.type === 'queue_update') {
      const e = event as { steering?: readonly string[]; followUp?: readonly string[] }
      batch(() => {
        setSteeringQueue([...(e.steering ?? [])])
        setFollowUpQueue([...(e.followUp ?? [])])
      })
      return
    }
    if (event.type === 'session_info_changed') {
      const e = event as { name?: string }
      setSessionNameState(e.name ?? null)
      return
    }

    setMessages((previous) =>
      applySessionEvent(previous, event, currentModelName, currentTurnStartMs)
    )
  }

  // ── Scroll-to-bottom on message changes ──────────────────────────────────
  // Scroll is owned by ConversationPane which has scroll container + user-intent tracking.
  // bottomEl is still stored via setBottomRef for potential future use.

  // ── Re-fetch models when session becomes ready ────────────────────────────
  createEffect(
    on(ready, (r) => {
      if (!r) return
      if (r.model) {
        window.openpi
          .getModels()
          .then((availableModels) => {
            setModels(availableModels)
            if (!currentModel() && availableModels.length) setCurrentModel(availableModels[0])
          })
          .catch(() => {})
      }

      // Focus composer when a session opens
      textareaEl?.focus()
    })
  )

  // ── Re-fetch session index when filter options change ─────────────────────
  createEffect(
    on(
      [sessionQuery, sortBy, groupBy, showRecent] as const,
      () => {
        void loadSessionIndex()
      },
      { defer: true }
    )
  )

  // ── IPC subscriptions (mounted once, cleaned up on unmount) ──────────────
  onMount(() => {
    const unsubs: Array<() => void> = []

    unsubs.push(window.openpi.onSessionEvent(handleEvent))
    unsubs.push(
      window.openpi.onRemoteSessionStatus((payload) => {
        setRemoteSessionStatus({
          app: payload.app,
          status: payload.status,
          pid: payload.pid,
          workspace: payload.workspace,
          sessionFile: payload.sessionFile,
        })
        if (payload.status !== 'running' && !payload.sessionFile) setRemoteSessionUpdate(null)
      })
    )

    unsubs.push(
      window.openpi.onRemoteSessionUpdate((payload) => {
        setRemoteSessionUpdate(payload)
      })
    )

    unsubs.push(
      window.openpi.onGoalUpdate((payload) => {
        setGoalUpdate(payload)
        // Treat the harness file as authoritative: create/edit replaces the text;
        // clear writes objective:null and must clear the banner.
        setActiveGoalText(payload.objective)
      })
    )

    unsubs.push(
      window.openpi.onPlanUpdate((payload) => {
        setPlanUpdate(payload)
      })
    )

    unsubs.push(
      window.openpi.onSessionReady((payload) => {
        latestSessionFile = payload.sessionFile ?? null

        batch(() => {
          setReady(payload)
          setSelectedWorkspacePath(payload.cwd)
          setMessages([])
          setError(null)
          setSteeringQueue([])
          setFollowUpQueue([])
          setSessionNameState(payload.sessionName ?? null)
          // Clear extension trackers on new session
          _taskTracker.clear()
          _askTracker.clear()
          _subagentTracker.clear()
          _notifiedAgentIds.clear()
          setSubagentNotification(null)
          setTasks([])
          setAskState(null)
          setAgents([])
          if (payload.model) {
            setCurrentModel(payload.model)
            currentModelName = payload.model.name
          }
          if (payload.thinkingLevel) setThinkingLevelState(payload.thinkingLevel)
          setHasMoreHistoryBefore(false)
          setHistoryBeforeEntryId(null)
          setContextPercent(null)
          setWorkspaceSummary(null)
        })

        const summaryCwd = payload.cwd
        window.openpi
          .getWorkspaceSummary(summaryCwd)
          .then((info) => {
            if (ready()?.cwd !== summaryCwd) return
            setWorkspaceSummary(info)
            setGitBranch(info.branch)
          })
          .catch(() => {
            if (ready()?.cwd !== summaryCwd) return
            setWorkspaceSummary(null)
            setGitBranch(null)
          })

        if (payload.sessionFile) {
          const sessionFile = payload.sessionFile
          window.openpi
            .getSessionMessages(sessionFile, { limit: HISTORY_PAGE_LIMIT })
            .then((page) => {
              if (latestSessionFile !== sessionFile) return
              batch(() => {
                setMessages(page.messages)
                setHasMoreHistoryBefore(page.hasMoreBefore)
                setHistoryBeforeEntryId(page.nextBeforeEntryId)
              })
            })
            .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
        }

        void loadSessionIndex(payload.cwd)
        void refreshContextUsage()
      })
    )

    unsubs.push(
      window.openpi.onSessionError((err) => {
        batch(() => {
          setError(err.message)
          setIsStreaming(false)
        })
      })
    )

    unsubs.push(
      window.openpi.onSessionIndexUpdated(() => {
        void loadSessionIndex()
      })
    )

    unsubs.push(
      window.openpi.git.onStatusChanged((s) => {
        setGitStats({
          added: s.totalAdded,
          removed: s.totalRemoved,
          untracked: s.files.filter((f) => f.status === '?').length,
          changed: s.files.length,
        })
      })
    )

    // Initial load
    void loadSessionIndex()

    onCleanup(() => {
      for (const u of unsubs) u()
    })
  })

  // ── Actions ───────────────────────────────────────────────────────────────

  const openWorkspace = async () => {
    setError(null)
    await window.openpi.pickWorkspace()
    await loadSessionIndex()
  }

  const openExistingSession = async (session: SessionListItem) => {
    setError(null)
    await window.openpi.openSession({ path: session.path })
  }

  const createNewSession = async () => {
    setError(null)
    await window.openpi.newSession(selectedWorkspaceForQuery() ?? ready()?.cwd)
  }

  const selectWorkspace = async (workspacePath: string) => {
    setSelectedWorkspacePath(workspacePath)
    await loadSessionIndex(workspacePath)
  }

  const loadWorkspacePreview = (workspacePath: string): Promise<SessionListItem[]> => {
    return window.openpi.getSessions({
      workspacePath,
      sortBy: 'updated',
      showRecent: false,
      limit: 8,
    })
  }

  const loadOlderSessionMessages = async () => {
    const sessionFile = latestSessionFile
    const beforeEntryId = historyBeforeEntryId()
    if (!sessionFile || !beforeEntryId || isLoadingOlderHistory()) return

    setIsLoadingOlderHistory(true)
    try {
      const page = await window.openpi.getSessionMessages(sessionFile, {
        limit: HISTORY_PAGE_LIMIT,
        beforeEntryId,
      })
      if (latestSessionFile !== sessionFile) return
      setMessages((previous) => {
        const seen = new Set(previous.map((message) => message.id))
        return [...page.messages.filter((message) => !seen.has(message.id)), ...previous]
      })
      setHasMoreHistoryBefore(page.hasMoreBefore)
      setHistoryBeforeEntryId(page.nextBeforeEntryId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsLoadingOlderHistory(false)
    }
  }

  const send = async (contextPrefix?: string) => {
    const promptPayload = buildSessionPromptPayload(input(), contextPrefix)
    const r = ready()
    if (!promptPayload.text || !r) return

    // Detect /goal command from the raw input text and sync goal state
    const rawText = input().trim()
    if (rawText.startsWith('/goal')) {
      const afterSlash = rawText.slice(5).trim()
      if (afterSlash && afterSlash.toLowerCase() !== 'clear') {
        setActiveGoalText(afterSlash)
      } else {
        setActiveGoalText(null)
      }
    }

    setInput('')
    if (textareaEl) textareaEl.style.height = 'auto'
    markLocalActivity()
    try {
      if (queueMode() === 'steer')
        await window.openpi.steer(promptPayload.text, promptPayload.contextPrefix)
      else if (queueMode() === 'followup')
        await window.openpi.followUp(promptPayload.text, promptPayload.contextPrefix)
      else {
        _justSentPrompt = true
        await window.openpi.prompt(promptPayload.text, promptPayload.contextPrefix)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const updateShellMessage = (id: string, result: BashExecutionResult | null, error?: string) => {
    setMessages((previous) =>
      previous.map((message) => {
        if (message.id !== id || message.role === 'system') return message
        const card = message.toolCards[0]
        if (!card) return message
        return {
          ...message,
          toolCards: [
            {
              ...card,
              output: error ?? result?.output ?? '',
              isError: !!error || (result?.exitCode ?? 0) !== 0,
              streaming: false,
            },
          ],
        }
      })
    )
  }

  const sendShell = async () => {
    const command = input().trim()
    const r = ready()
    if (!command || !r || isShellRunning()) return

    const id = `bash-${Date.now()}`
    setInput('')
    if (textareaEl) textareaEl.style.height = 'auto'
    setIsShellRunning(true)
    setMessages((previous) => [
      ...previous,
      {
        id,
        role: 'assistant',
        text: '',
        toolCards: [
          {
            toolCallId: id,
            toolName: 'bash',
            args: { command },
            output: '',
            isError: false,
            streaming: true,
          },
        ],
      },
    ])

    try {
      const result = await window.openpi.bash(command)
      updateShellMessage(id, result)
      void refreshContextUsage()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      updateShellMessage(id, null, message)
    } finally {
      setIsShellRunning(false)
    }
  }

  const selectModel = async (model: ModelInfo) => {
    setCurrentModel(model)
    currentModelName = model.name
    await window.openpi.setModel({ provider: model.provider, modelId: model.id })
  }

  const refreshModels = () => {
    window.openpi
      .getModels()
      .then((availableModels) => {
        setModels(availableModels)
      })
      .catch(() => {})
  }

  const selectThinkingLevel = async (level: string) => {
    setThinkingLevelState(level)
    await window.openpi.setThinking(level)
  }

  const toggleGroup = (group: string) => {
    setCollapsedGroups((previous) => {
      const next = new Set(previous)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

  const collapseAllGroups = () => {
    setCollapsedGroups(new Set(groupSessions(sessions(), groupBy()).map((group) => group.key)))
  }

  const setSessionName = async (name: string) => {
    try {
      await window.openpi.setSessionName(name)
      setSessionNameState(name)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const forkFromMessage = async (messageId: string) => {
    try {
      await window.openpi.forkSession(messageId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  // ── Ask-user-question actions ─────────────────────────────────────────
  const submitAsk = async (formatted: string) => {
    _askTracker.clear()
    setAskState(null)
    markLocalActivity()
    try {
      if (isStreaming()) {
        await window.openpi.steer(formatted)
      } else {
        _justSentPrompt = true
        await window.openpi.prompt(formatted)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const dismissAsk = () => {
    _askTracker.clear()
    setAskState(null)
  }

  // ── Goal actions ──────────────────────────────────────────────────────────
  const setActiveGoal = (text: string | null) => {
    setActiveGoalText(text)
    if (text === null && ready()) {
      void window.openpi.prompt('/goal clear').catch((err) => {
        setError(err instanceof Error ? err.message : String(err))
      })
    }
  }
  const clearActiveGoal = () => {
    setActiveGoalText(null)
  }

  // ── Return — getter-based object so callers use session.ready (not session.ready()) ──
  return {
    // Signals exposed as getters (transparent to callers, reactive in JSX/createEffect)
    get ready() {
      return ready()
    },
    get messages() {
      return messages()
    },
    get isStreaming() {
      return isStreaming()
    },
    get agentRunMetrics() {
      return agentRunMetrics()
    },
    get isShellRunning() {
      return isShellRunning()
    },
    get input() {
      return input()
    },
    get models() {
      return models()
    },
    get error() {
      return error()
    },
    get queueMode() {
      return queueMode()
    },
    get currentModel() {
      return currentModel()
    },
    get workspaces() {
      return workspaces()
    },
    get sessions() {
      return sessions()
    },
    get selectedWorkspacePath() {
      return selectedWorkspacePath()
    },
    get sessionQuery() {
      return sessionQuery()
    },
    get sortBy() {
      return sortBy()
    },
    get groupBy() {
      return groupBy()
    },
    get showRecent() {
      return showRecent()
    },
    get collapsedGroups() {
      return collapsedGroups()
    },
    get gitBranch() {
      return gitBranch()
    },
    get workspaceSummary() {
      return workspaceSummary()
    },
    get gitStats() {
      return gitStats()
    },
    get activeGoalText() {
      return activeGoalText()
    },
    get activeGoalStep() {
      const goal = activeGoalText()
      if (!goal) return null
      const status = goalUpdate()?.status
      if (status === 'complete' || status === 'paused' || status === 'budget_limited') return status
      return isStreaming() ? 'running' : 'idle'
    },
    get activeGoalElapsed() {
      const base = goalUpdate()?.timeUsedSeconds ?? 0
      return base + goalElapsedOffset()
    },
    get activeGoalProgress() {
      const gu = goalUpdate()
      if (!gu || gu.tokensUsed === undefined) return null
      return {
        tokensUsed: gu.tokensUsed,
        tokenBudget: gu.tokenBudget,
        percent: gu.tokenBudget ? Math.min(gu.tokensUsed / gu.tokenBudget, 1) : null,
      }
    },
    get steeringQueue() {
      return steeringQueue()
    },
    get followUpQueue() {
      return followUpQueue()
    },
    get remoteSessionStatus() {
      return remoteSessionStatus()
    },
    get remoteSessionMessages() {
      return remoteSessionUpdate()?.messages ?? []
    },
    get remoteSessionUpdatedAt() {
      return remoteSessionUpdate()?.updatedAt ?? 0
    },
    get goalUpdate() {
      return goalUpdate()
    },
    get planUpdate() {
      return planUpdate()
    },

    get localActivityAt() {
      return localActivityAt()
    },
    get sessionName() {
      return sessionName()
    },
    get contextPercent() {
      return contextPercent()
    },
    get thinkingLevel() {
      return thinkingLevel()
    },
    get hasMoreHistoryBefore() {
      return hasMoreHistoryBefore()
    },
    get isLoadingOlderHistory() {
      return isLoadingOlderHistory()
    },

    // ── Extension tracker state ─────────────────────────────────────
    get tasks() {
      return tasks()
    },
    get askState() {
      return askState()
    },
    get agents() {
      return agents()
    },
    get subagentNotification() {
      return subagentNotification()
    },
    dismissSubagentNotification: () => setSubagentNotification(null),

    // Ref setters — pass as `ref={session.setBottomRef}` in JSX
    setBottomRef: (el: HTMLDivElement) => {
      _bottomEl = el
    },
    setTextareaRef: (el: HTMLTextAreaElement) => {
      textareaEl = el
    },

    // Setters
    setInput,
    setError,
    setQueueMode,
    setSessionQuery,
    setSortBy,
    setGroupBy,
    setShowRecent,

    // Actions
    openWorkspace,
    openExistingSession,
    createNewSession,
    selectWorkspace,
    loadWorkspacePreview,
    loadOlderSessionMessages,
    send,
    sendShell,
    selectModel,
    refreshModels,
    selectThinkingLevel,
    toggleGroup,
    collapseAllGroups,
    setSessionName,
    forkFromMessage,
    submitAsk,
    dismissAsk,
    setActiveGoal,
    clearActiveGoal,

    clearTasks: () => {
      _taskTracker.clear()
      setTasks([])
    },
  }
}
