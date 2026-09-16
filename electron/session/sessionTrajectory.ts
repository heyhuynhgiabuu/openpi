/**
 * sessionTrajectory.ts — flat, branch-aware trajectory rows for one session.
 *
 * The ledger view complements the session map: instead of every branch's
 * tree, it shows the branch the session is currently on as a chronological
 * root→leaf list with the per-entry timing/token/cost metrics the indexer
 * already computed. Rows carry their entry ids so the UI can deep-link into
 * the conversation and the map. Pure function — no store or SDK state.
 */
import type { SessionTrajectoryResponse, TrajectoryRow } from '../../src/lib/ipc'
import { parseSessionFile } from './sessionEntries'
import { buildTreeNodes, traceToRoot } from './sessionTree'
import { usageMetricsByEntryId } from './sessionUsage'

export function buildSessionTrajectory(
  sessionPath: string,
  leafId?: string
): SessionTrajectoryResponse {
  try {
    const { entries } = parseSessionFile(sessionPath)
    if (entries.length === 0) return { sessionPath, activeLeafId: null, rows: [] }

    const entryById = new Map(entries.map((entry) => [entry.id, entry]))
    const lastEntryId = entries[entries.length - 1]?.id ?? null
    const activeLeafId = leafId && entryById.has(leafId) ? leafId : lastEntryId
    if (!activeLeafId) return { sessionPath, activeLeafId: null, rows: [] }

    // Root → leaf along the branch the session is currently on.
    const pathIds = traceToRoot(activeLeafId, entryById)
    const nodes = buildTreeNodes(pathIds, entryById)
    const usageByEntryId = usageMetricsByEntryId(entries)

    const rows: TrajectoryRow[] = nodes.map((node) => {
      const usage = usageByEntryId.get(node.id)
      const preview = node.contentPreview ?? node.summary ?? node.name ?? node.modelId ?? ''
      return {
        entryId: node.id,
        parentId: node.parentId,
        type: node.type,
        role: node.role ?? null,
        timestamp: node.timestamp,
        preview,
        freedTokens: node.tokensBefore ?? null,
        navigable: node.type === 'message',
        model: (usage?.model ?? '') || node.modelId || null,
        provider: usage?.provider || null,
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        cacheReadTokens: usage?.cacheReadTokens ?? 0,
        cacheWriteTokens: usage?.cacheWriteTokens ?? 0,
        totalTokens: usage?.totalTokens ?? 0,
        durationMs: usage?.durationMs ?? 0,
        cost: usage?.cost ?? 0,
      }
    })
    return { sessionPath, activeLeafId, rows }
  } catch {
    return { sessionPath, activeLeafId: null, rows: [] }
  }
}
