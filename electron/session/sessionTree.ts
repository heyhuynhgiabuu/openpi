/**
 * sessionTree.ts — Session entry tree operations.
 * Extracted from sessionEntries.ts.
 */

import type { TreeEntryNode, TreeEntryType } from '../../src/lib/ipc'
import type { SessionEntry } from './sessionEntries'
import { contentToText, truncate } from './sessionEntryUtils'

export function countBranches(entries: SessionEntry[]): number {
  const childCounts = new Map<string | null, number>()
  for (const entry of entries) {
    childCounts.set(entry.parentId, (childCounts.get(entry.parentId) ?? 0) + 1)
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
 */
export function traceToRoot(leafId: string, entryById: Map<string, SessionEntry>): string[] {
  const path: string[] = [leafId]
  let current = entryById.get(leafId)?.parentId ?? null

  while (current !== null && entryById.has(current)) {
    path.unshift(current)
    current = entryById.get(current)!.parentId
  }

  return path
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
      base.role = (msg.role as 'user' | 'assistant') ?? undefined
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
