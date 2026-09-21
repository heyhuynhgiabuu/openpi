/**
 * sessionTree.ts — Session entry tree operations.
 * Extracted from sessionEntries.ts.
 */

import type { TreeEntryNode, TreeEntryType } from '../../src/lib/ipc'
import type { SessionEntry } from './sessionEntries'
import { contentToText, isRecord, truncate } from './sessionEntryUtils'

export function countBranches(entries: SessionEntry[]): number {
  const hiddenIds = displayHiddenEntryIds(entries)
  const entryById = new Map(entries.map((entry) => [entry.id, entry]))
  const childCounts = new Map<string | null, number>()
  for (const entry of entries) {
    if (hiddenIds.has(entry.id)) continue
    const parentId = nearestVisibleAncestor(entry.parentId, entryById, hiddenIds)
    childCounts.set(parentId, (childCounts.get(parentId) ?? 0) + 1)
  }
  return Array.from(childCounts.values()).reduce(
    (count, children) => count + Math.max(0, children - 1),
    0
  )
}

/**
 * Collect all leaf entry IDs reachable from a starting entry ID.
 * A leaf is an entry with no children in the adjacency map.
 */
export function collectLeaves(
  startId: string | null,
  childrenOf: Map<string | null, SessionEntry[]>
): string[] {
  if (startId === null) return []

  const leaves: string[] = []
  const stack = [startId]
  const visited = new Set<string>()

  while (stack.length > 0) {
    const id = stack.pop()!
    if (visited.has(id)) continue
    visited.add(id)

    const kids = childrenOf.get(id)
    if (!kids || kids.length === 0) {
      leaves.push(id)
    } else {
      for (const kid of kids) {
        if (!visited.has(kid.id)) stack.push(kid.id)
      }
    }
  }

  return leaves
}

/**
 * Trace from a leaf entry back to the root, returning entry IDs ordered root → leaf.
 * IDs in `skip` (0.86 usage/system metadata) are walked through but omitted from
 * the path, so callers can splice metadata out without breaking the chain.
 */
export function traceToRoot(
  leafId: string,
  entryById: Map<string, SessionEntry>,
  skip?: ReadonlySet<string>
): string[] {
  const path: string[] = [leafId]
  const seen = new Set([leafId])
  let current = entryById.get(leafId)?.parentId ?? null

  while (current !== null && entryById.has(current) && !seen.has(current)) {
    seen.add(current)
    path.unshift(current)
    current = entryById.get(current)?.parentId ?? null
  }

  return skip ? path.filter((id) => !skip.has(id)) : path
}

/**
 * Walk up from `entryId` to the nearest entry not in `hiddenIds` (0.86 usage /
 * system metadata). Returns null when only hidden entries remain.
 */
export function nearestVisibleAncestor(
  entryId: string | null,
  entryById: Map<string, SessionEntry>,
  hiddenIds: ReadonlySet<string>
): string | null {
  let cursor = entryId
  const seen = new Set<string>()
  while (cursor !== null && hiddenIds.has(cursor)) {
    if (seen.has(cursor)) return null
    seen.add(cursor)
    cursor = entryById.get(cursor)?.parentId ?? null
  }
  return cursor
}

/**
 * Pi 0.86 appends standalone `usage` entries (cache warming) and mid-conversation
 * system messages to the session tree. Neither is a conversation turn — Pi docs
 * keep usage out of LLM context, and the tree contract's message roles are only
 * user|assistant — so the read model splices them out of displayed branches and
 * ledger rows while chains pass through to the nearest visible ancestor. Their
 * usage still counts via usageTotals and the SQLite index.
 */
export function displayHiddenEntryIds(entries: SessionEntry[]): Set<string> {
  const hidden = new Set<string>()
  for (const entry of entries) {
    if (entry.type === 'usage') {
      hidden.add(entry.id)
      continue
    }
    if (entry.type !== 'message') continue
    const message = entry.message
    if (isRecord(message) && message.role === 'system') hidden.add(entry.id)
  }
  return hidden
}

/**
 * Convert a list of entry IDs (ordered root → leaf) into TreeEntryNode[]
 * by enriching each entry from its raw JSONL data.
 */
export function buildTreeNodes(
  entryIds: string[],
  entryById: Map<string, SessionEntry>
): TreeEntryNode[] {
  return entryIds.map((id) => {
    const entry = entryById.get(id)
    if (!entry) {
      return { id, parentId: null, type: 'message', timestamp: '' }
    }
    return entryToTreeNode(entry)
  })
}

/**
 * Convert a raw SessionEntry into a TreeEntryNode with type-specific enrichment.
 */
export function entryToTreeNode(entry: SessionEntry): TreeEntryNode {
  const rawType = entry.type as string
  const displayType: TreeEntryType =
    rawType === 'custom' || rawType === 'custom_message' ? 'message' : (rawType as TreeEntryType)

  const base: TreeEntryNode = {
    id: entry.id,
    parentId: entry.parentId,
    type: displayType,
    timestamp: entry.timestamp,
  }

  const raw = entry as Record<string, unknown>

  switch (entry.type) {
    case 'message': {
      const msg = (raw.message ?? {}) as Record<string, unknown>
      // Only user/assistant fit the tree contract; a 0.86 system message is
      // metadata (displayHiddenEntryIds), never mislabeled as an assistant.
      base.role = msg.role === 'user' || msg.role === 'assistant' ? msg.role : undefined
      base.contentPreview = truncate(contentToText(msg.content), 80)
      break
    }
    case 'compaction': {
      const result = raw.result as Record<string, unknown> | undefined
      base.tokensBefore = typeof result?.tokensBefore === 'number' ? result.tokensBefore : undefined
      base.compactionReason = (raw.reason as string) ?? undefined
      base.summary = (result?.summary as string) ?? undefined
      break
    }
    case 'label': {
      base.targetId = (raw.targetId as string) ?? undefined
      const label = raw.label
      base.summary = typeof label === 'string' ? label : undefined
      break
    }
    case 'branch_summary': {
      base.summary = (raw.summary as string) ?? undefined
      break
    }
    case 'model_change': {
      base.modelId = (raw.modelId as string) ?? undefined
      base.summary = base.modelId
      break
    }
    case 'session_info': {
      base.name = (raw.name as string) ?? undefined
      base.summary = base.name
      break
    }
    case 'thinking_level_change': {
      const level = raw.thinkingLevel as string | undefined
      base.summary = level ? `Thinking level: ${level}` : 'Thinking level changed'
      break
    }
  }

  return base
}
