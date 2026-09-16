/**
 * Session event pipe: the single reducer that folds every sidecar session
 * event into renderer state. Pure fold — no IPC registration here (the hook
 * owns subscriptions); wiring lives in useOpenPiSession.
 */

import { batch } from 'solid-js'
import type { SessionEvent } from '../../lib/ipc'
import { asUiPromptEvent, applySessionEvent } from '../../lib/sessionEvents'
import type { Message } from '../../types/session'
import type { useAgentRunMetrics } from '../useAgentRunMetrics'
import type { useExtensionTrackers } from '../useExtensionTrackers'
import type { useRemoteSessionSync } from '../useRemoteSessionSync'

export type QueueMode = 'prompt' | 'steer' | 'followup'

/** Agent is blocked on a ctx.ui prompt (Pi 0.85 ui_prompt_start/end events). */
export interface AwaitingPrompt {
  title: string | null
}

/** Mutable closure state shared between the event pipe and the actions. */
export interface SessionPipeRefs {
  justSentPrompt: boolean
  currentModelName: string | null
  currentTurnStartMs: number | null
  textareaEl: HTMLTextAreaElement | undefined
}

export interface SessionEventPipeDeps {
  refs: SessionPipeRefs
  refreshContextUsage: () => Promise<void>
  remoteSync: Pick<ReturnType<typeof useRemoteSessionSync>, 'markLocalActivity'>
  agentRunMetrics: ReturnType<typeof useAgentRunMetrics>
  trackers: Pick<ReturnType<typeof useExtensionTrackers>, 'dispatchEvent' | 'clearFinished'>
  setIsStreaming: (value: boolean) => void
  setAwaitingPrompt: (value: AwaitingPrompt | null) => void
  setQueueMode: (value: QueueMode) => void
  setSteeringQueue: (value: string[]) => void
  setFollowUpQueue: (value: string[]) => void
  setSessionNameState: (value: string | null) => void
  setMessages: (update: (previous: Message[]) => Message[]) => void
  setBranchLeafId: (value: string | null) => void
  setTreeVersion: (update: (version: number) => number) => void
}

/** Session events that append an entry to the JSONL, so the tree can change. */
const APPEND_EVENTS = new Set([
  'message_start',
  'tool_execution_end',
  'compaction_end',
  'session_info_changed',
  'agent_end',
])

export function createSessionEventHandle(deps: SessionEventPipeDeps) {
  const { refs } = deps
  return (event: SessionEvent): void => {
    if (event.type === 'agent_start') {
      deps.setIsStreaming(true)
      deps.remoteSync.markLocalActivity()
      deps.agentRunMetrics.start()
      // Auto-activate steer mode ONLY when the user explicitly sent a fresh
      // prompt — not on every agent_start (e.g. intermediate restarts after
      // a steer delivery). This prevents overriding a mode the user set
      // intentionally while the agent was already running.
      if (refs.justSentPrompt) {
        deps.setQueueMode('steer')
        refs.justSentPrompt = false
      }
    }
    if (event.type === 'turn_start') {
      const e = event as { timestamp?: number }
      refs.currentTurnStartMs = e.timestamp ?? Date.now()
    }
    if (event.type === 'turn_end') {
      // Live run totals: `turn_end` carries the assistant message with usage,
      // so tokens/cost update per turn instead of only at `agent_end`.
      deps.agentRunMetrics.addTurn(event)
      void deps.refreshContextUsage()
    }
    if (event.type === 'agent_end') {
      deps.setIsStreaming(false)
      deps.setAwaitingPrompt(null)
      deps.setQueueMode('prompt')
      refs.currentTurnStartMs = null
      void deps.refreshContextUsage()
      // Clear finished subagents on session end; keep task tray across agent turns
      deps.trackers.clearFinished()

      deps.agentRunMetrics.finish()
    }

    // ── Extension tracker dispatch ───────────────────────────────────────
    if (event.type === 'tool_execution_start' || event.type === 'tool_execution_end') {
      deps.trackers.dispatchEvent(event as Record<string, unknown>, event.type)
    }

    // Any appended entry becomes the file's last line again, so the file order
    // is authoritative from here on and the branch override would go stale.
    if (event.type === 'message_start') deps.setBranchLeafId(null)
    if (APPEND_EVENTS.has(event.type)) deps.setTreeVersion((version) => version + 1)

    if (event.type === 'queue_update') {
      const e = event as { steering?: readonly string[]; followUp?: readonly string[] }
      batch(() => {
        deps.setSteeringQueue([...(e.steering ?? [])])
        deps.setFollowUpQueue([...(e.followUp ?? [])])
      })
      return
    }
    if (event.type === 'session_info_changed') {
      const e = event as { name?: string }
      deps.setSessionNameState(e.name ?? null)
      return
    }

    const prompt = asUiPromptEvent(event)
    if (prompt) {
      deps.setAwaitingPrompt(prompt.type === 'ui_prompt_start' ? { title: prompt.title } : null)
      return
    }

    deps.setMessages((previous) =>
      applySessionEvent(previous, event, refs.currentModelName, refs.currentTurnStartMs)
    )
  }
}
