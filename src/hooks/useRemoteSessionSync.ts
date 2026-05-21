import { createEffect, createSignal, onCleanup } from 'solid-js'
import type { GoalUpdate, PlanUpdate, RemoteSessionUpdate } from '../lib/ipc'

interface RemoteSessionStatus {
  app: string
  status: string
  pid: number
  workspace?: string
  sessionFile?: string | null
}

interface UseRemoteSessionSyncOptions {
  isStreaming: () => boolean
  isReady: () => boolean
  setError: (message: string | null) => void
}

export function useRemoteSessionSync(options: UseRemoteSessionSyncOptions) {
  const [activeGoalText, setActiveGoalText] = createSignal<string | null>(null)
  const [remoteSessionStatus, setRemoteSessionStatus] = createSignal<RemoteSessionStatus | null>(
    null
  )
  const [remoteSessionUpdate, setRemoteSessionUpdate] = createSignal<RemoteSessionUpdate | null>(
    null
  )
  const [goalUpdate, setGoalUpdate] = createSignal<GoalUpdate | null>(null)
  const [planUpdate, setPlanUpdate] = createSignal<PlanUpdate | null>(null)
  const [goalElapsedOffset, setGoalElapsedOffset] = createSignal(0)
  const [localActivityAt, setLocalActivityAt] = createSignal(0)

  createEffect(() => {
    if (options.isStreaming() && activeGoalText()) {
      const id = setInterval(() => {
        setGoalElapsedOffset((offset) => offset + 1)
      }, 1000)
      onCleanup(() => clearInterval(id))
    } else {
      setGoalElapsedOffset(0)
    }
  })

  const markLocalActivity = () => {
    setLocalActivityAt(Date.now())
    setRemoteSessionStatus(null)
    setRemoteSessionUpdate(null)
  }

  const handleRemoteSessionStatus = (payload: RemoteSessionStatus) => {
    setRemoteSessionStatus({
      app: payload.app,
      status: payload.status,
      pid: payload.pid,
      workspace: payload.workspace,
      sessionFile: payload.sessionFile,
    })
    if (payload.status !== 'running' && !payload.sessionFile) setRemoteSessionUpdate(null)
  }

  const handleRemoteSessionUpdate = (payload: RemoteSessionUpdate) => {
    setRemoteSessionUpdate(payload)
  }

  const handleGoalUpdate = (payload: GoalUpdate) => {
    setGoalUpdate(payload)
    // Treat the harness file as authoritative: create/edit replaces the text;
    // clear writes objective:null and must clear the banner.
    setActiveGoalText(payload.objective)
  }

  const handlePlanUpdate = (payload: PlanUpdate) => {
    setPlanUpdate(payload)
  }

  const syncGoalFromInput = (inputText: string) => {
    const rawText = inputText.trim()
    if (!rawText.startsWith('/goal')) return

    const afterSlash = rawText.slice(5).trim()
    if (afterSlash && afterSlash.toLowerCase() !== 'clear') {
      setActiveGoalText(afterSlash)
    } else {
      setActiveGoalText(null)
    }
  }

  const setActiveGoal = (text: string | null) => {
    setActiveGoalText(text)
    if (text === null && options.isReady()) {
      void window.openpi.prompt('/goal clear').catch((err) => {
        options.setError(err instanceof Error ? err.message : String(err))
      })
    }
  }

  const clearActiveGoal = () => {
    setActiveGoalText(null)
  }

  const activeGoalStep = () => {
    const goal = activeGoalText()
    if (!goal) return null
    const status = goalUpdate()?.status
    if (status === 'complete' || status === 'paused' || status === 'budget_limited') return status
    return options.isStreaming() ? 'running' : 'idle'
  }

  const activeGoalElapsed = () => {
    const base = goalUpdate()?.timeUsedSeconds ?? 0
    return base + goalElapsedOffset()
  }

  const activeGoalProgress = () => {
    const currentGoalUpdate = goalUpdate()
    if (!currentGoalUpdate || currentGoalUpdate.tokensUsed === undefined) return null
    return {
      tokensUsed: currentGoalUpdate.tokensUsed,
      tokenBudget: currentGoalUpdate.tokenBudget,
      percent: currentGoalUpdate.tokenBudget
        ? Math.min(currentGoalUpdate.tokensUsed / currentGoalUpdate.tokenBudget, 1)
        : null,
    }
  }

  return {
    activeGoalText,
    activeGoalStep,
    activeGoalElapsed,
    activeGoalProgress,
    remoteSessionStatus,
    remoteSessionMessages: () => remoteSessionUpdate()?.messages ?? [],
    remoteSessionUpdatedAt: () => remoteSessionUpdate()?.updatedAt ?? 0,
    goalUpdate,
    planUpdate,
    localActivityAt,
    markLocalActivity,
    handleRemoteSessionStatus,
    handleRemoteSessionUpdate,
    handleGoalUpdate,
    handlePlanUpdate,
    syncGoalFromInput,
    setActiveGoal,
    clearActiveGoal,
  }
}
