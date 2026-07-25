export interface TaskHistoryEntry {
  id: string
  agentType?: string
  description?: string
  startedAt?: number
  sessionName?: string
  paneId?: string
  sessionRef?: string
  status?: string
}

/**
 * Find a task id in the history that best matches a parent tool card.
 *
 * Matches by `agentType` + `description` (both must be equal — when
 * provided). If `toolStartedAt` is given, picks the entry whose
 * `startedAt` is closest to it; otherwise picks the most recent
 * matching entry. The 5-minute cap prevents stale matching entries
 * from opening old sub-sessions when a task row is clicked before the
 * current task id has landed in history.
 */
export const MAX_TIME_DELTA_MS = 5 * 60 * 1000

export type TaskStatus = 'running' | 'done' | 'error'

export function resolveTaskStatusFromHistory(
  history: TaskHistoryEntry[],
  taskId: string | null
): TaskStatus | null {
  if (!taskId) return null
  const entry = history.find((item) => item.id === taskId)
  if (!entry) return null
  switch (entry.status) {
    case 'running':
      return 'running'
    case 'done':
      return 'done'
    case 'cancelled':
    case 'aborted':
    case 'failed':
    case 'timeout':
      return 'error'
    default:
      return null
  }
}

export function findTaskIdForToolCall(
  history: TaskHistoryEntry[],
  agentType: string | null | undefined,
  description: string | null | undefined,
  toolStartedAt: number | null | undefined
): string | null {
  if (!history.length) return null
  const at = (agentType ?? '').trim()
  const desc = (description ?? '').trim()
  if (!at && !desc) return null
  const candidates = history.filter((entry) => {
    const entryAt = (entry.agentType ?? '').trim()
    const entryDesc = (entry.description ?? '').trim()
    if (at && entryAt !== at) return false
    if (desc && entryDesc !== desc) return false
    return true
  })
  if (candidates.length === 0) return null

  if (typeof toolStartedAt !== 'number') {
    const sorted = [...candidates].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
    return sorted[0]?.id ?? null
  }

  let best: { entry: TaskHistoryEntry; delta: number } | null = null
  for (const entry of candidates) {
    if (typeof entry.startedAt !== 'number') continue
    const delta = Math.abs(entry.startedAt - toolStartedAt)
    if (best === null || delta < best.delta) {
      best = { entry, delta }
    }
  }
  if (best && best.delta <= MAX_TIME_DELTA_MS) return best.entry.id
  // No candidate within the time window. When matching by agentType only
  // (description is null), fall back to the most recent matching entry so
  // a stale click still navigates somewhere sensible. When description was
  // provided as an exact match, a single stale hit is probably wrong - bail.
  if (description !== null && description !== undefined) return null
  if (candidates.length === 0) return null
  const sorted = [...candidates].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
  return sorted[0]?.id ?? null
}
