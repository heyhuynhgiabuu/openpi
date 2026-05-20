import type { Branch, ForkPoint, SessionTreeResponse, TreeEntryNode } from '../../src/lib/ipc'
import type { SessionEntry } from './sessionEntries'
import { parseSessionFile } from './sessionEntries'
import { buildTreeNodes, collectLeaves, traceToRoot } from './sessionTree'

/**
 * Build a session tree from a JSONL session file.
 *
 * Extracted from SessionIndexStore because it is a pure function that
 * does not depend on any class state.
 */
export function buildSessionTree(sessionPath: string): SessionTreeResponse {
  try {
    const parsed = parseSessionFile(sessionPath)
    const { entries } = parsed

    if (entries.length === 0) {
      return { sessionPath, branches: [], forkPoints: [], activeLeafId: null }
    }

    // ── Build adjacency: parentId → child entries ────────────────────────
    const childrenOf = new Map<string | null, SessionEntry[]>()
    const entryById = new Map<string, SessionEntry>()

    // Track entries in JSONL file order so we can determine the active leaf.
    // The last non-session entry in the file is the current leaf.
    let lastEntryId: string | null = null

    for (const entry of entries) {
      entryById.set(entry.id, entry)
      const list = childrenOf.get(entry.parentId) ?? []
      list.push(entry)
      childrenOf.set(entry.parentId, list)
      lastEntryId = entry.id
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
    const rootId = entries.find((e) => e.parentId === null)?.id ?? null
    const branches: Branch[] = []

    if (rootId) {
      const leafIds = collectLeaves(rootId, childrenOf)
      for (const leafId of leafIds) {
        const pathIds = traceToRoot(leafId, entryById)
        const nodes: TreeEntryNode[] = buildTreeNodes(pathIds, entryById)
        branches.push({ leafId, nodes })
      }
    }

    const activeLeafId = lastEntryId

    return { sessionPath, branches, forkPoints, activeLeafId }
  } catch {
    return { sessionPath, branches: [], forkPoints: [], activeLeafId: null }
  }
}
