/**
 * Resolve pi-task identities for `task` tool cards, from tracker state and
 * the polled task-session history.
 */

import {
  findTaskIdForToolCall,
  resolveTaskStatusFromHistory,
  type TaskHistoryEntry,
} from '../../lib/taskHistory'
import { isValidPiTaskId } from '../../lib/taskToolHelpers'
import type { ToolCard } from '../../types/session'
import type { useExtensionTrackers } from '../useExtensionTrackers'

export interface TaskCardResolverDeps {
  trackers: Pick<ReturnType<typeof useExtensionTrackers>, 'tasks'>
  taskHistory: () => TaskHistoryEntry[]
}

export function createTaskCardResolvers(deps: TaskCardResolverDeps) {
  /**
   * Resolve the pi-task short id for a `task` tool card.
   *
   * Lookup chain (first hit wins):
   *  1. `TaskTracker.tasks[]` keyed by `card.toolCallId` — the tracker
   *     is populated from the tool's *result* `details.task_id` when
   *     the call ends.
   *  2. `card.details.task_id` (the structured result field) — this is
   *     a defensive backup; pi-task does not always emit it in the
   *     `tool_execution_end` event.
   *  3. `task-session-history.json` — pi-task writes this at task
   *     start with `{id, agentType, description, startedAt}`. We match
   *     by `agentType` + `description` + closest `startedAt`. This
   *     works for both running (history is written on start) and
   *     completed tasks.
   *
   * Returns `null` when no source has a resolvable id. Caller is
   * expected to render a non-interactive status line in that case.
   */
  const resolveTaskIdForCard = (card: ToolCard): string | null => {
    // 1. Tracker
    const fromTracker = deps.trackers.tasks().find((t) => t.tempId === card.toolCallId)?.taskId
    if (typeof fromTracker === 'string' && isValidPiTaskId(fromTracker)) {
      return fromTracker
    }
    // 2. card.details.task_id
    const fromDetails =
      card.details && typeof card.details === 'object'
        ? (card.details as Record<string, unknown>).task_id
        : undefined
    if (typeof fromDetails === 'string' && isValidPiTaskId(fromDetails)) {
      return fromDetails
    }
    // 3. History lookup
    const args = (card.args ?? {}) as Record<string, unknown>
    const agentType = typeof args.agent_type === 'string' ? args.agent_type : null
    const description = typeof args.description === 'string' ? args.description : null
    return findTaskIdForToolCall(deps.taskHistory(), agentType, description, card.startedAt)
  }

  const resolveTaskStatusForTaskId = (taskId: string | null): 'running' | 'done' | 'error' | null =>
    resolveTaskStatusFromHistory(deps.taskHistory(), taskId)

  return { resolveTaskIdForCard, resolveTaskStatusForTaskId }
}
