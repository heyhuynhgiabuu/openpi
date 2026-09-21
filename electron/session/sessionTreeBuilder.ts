import type { Branch, ForkPoint, SessionTreeResponse, TreeEntryNode } from '../../src/lib/ipc'
import type { SessionEntry } from './sessionEntries'
import { parseSessionFile } from './sessionEntries'
import {
  buildTreeNodes,
  collectLeaves,
  displayHiddenEntryIds,
  nearestVisibleAncestor,
  traceToRoot,
} from './sessionTree'

/**
 * Build a session tree from a JSONL session file.
 *
 * Extracted from SessionIndexStore because it is a pure function that
 * does not depend on any class state.
 */
export function buildSessionTree(sessionPath: string, leafId?: string): SessionTreeResponse {
  try {
    const parsed = parseSessionFile(sessionPath)
    const { entries } = parsed

    if (entries.length === 0) {
      return { sessionPath, branches: [], forkPoints: [], activeLeafId: null }
    }

    // ── Build adjacency: parentId → child entries ────────────────────────
    // 0.86 usage/system metadata entries are spliced out of the displayed
    // tree: children attach to the nearest visible ancestor, and hidden
    // entries never appear as branches, nodes, or the active leaf.
    const hiddenIds = displayHiddenEntryIds(entries)
    const childrenOf = new Map<string | null, SessionEntry[]>()
    const entryById = new Map<string, SessionEntry>()

    // Track entries in JSONL file order so we can determine the active leaf.
    // The last non-session entry in the file is the current leaf.
    let lastEntryId: string | null = null

    for (const entry of entries) {
      entryById.set(entry.id, entry)
      lastEntryId = entry.id
    }
    for (const entry of entries) {
      if (hiddenIds.has(entry.id)) continue
      const parent = nearestVisibleAncestor(entry.parentId, entryById, hiddenIds)
      const list = childrenOf.get(parent) ?? []
      list.push(entry)
      childrenOf.set(parent, list)
    }

    // ── Detect fork points (entries with >1 child) ──────────────────────
    const forkPoints: ForkPoint[] = []

    for (const [parentId, children] of childrenOf) {
      if (parentId === null) continue
      if (children.length <= 1) continue

      // Collect leaf IDs for each child branch
      const childLeaves: string[] = []
      for (const child of children) {
        const leaves = collectLeaves(child.id, childrenOf)
        childLeaves.push(...leaves)
      }

      forkPoints.push({
        entryId: parentId,
        childLeaves,
        branchCount: children.length,
      })
    }

    // ── Build branch list (all root-to-leaf paths) ───────────────────────
    // A leading system message is hidden in 0.86, so visible roots attach to
    // the synthetic null root. Iterate every root to preserve malformed or
    // hand-authored sessions with more than one root branch.
    const rootIds = childrenOf.get(null)?.map((entry) => entry.id) ?? []
    const branches: Branch[] = []

    for (const rootId of rootIds) {
      const leafIds = collectLeaves(rootId, childrenOf)
      for (const leafId of leafIds) {
        const pathIds = traceToRoot(leafId, entryById, hiddenIds)
        const nodes: TreeEntryNode[] = buildTreeNodes(pathIds, entryById)
        branches.push({ leafId, nodes })
      }
    }

    // A branch switch moves Pi's leaf without writing an entry, so a caller that
    // just switched names the leaf; otherwise the file's last entry is the leaf.
    // A 0.86 usage leaf (cache warming after a turn) resolves up to the nearest
    // conversation entry, which is where the session visibly sits.
    const activeLeafId = nearestVisibleAncestor(
      leafId && entryById.has(leafId) ? leafId : lastEntryId,
      entryById,
      hiddenIds
    )

    return { sessionPath, branches, forkPoints, activeLeafId }
  } catch {
    return { sessionPath, branches: [], forkPoints: [], activeLeafId: null }
  }
}
