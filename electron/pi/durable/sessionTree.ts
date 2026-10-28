import type { EntryRecord } from '@earendil-works/pi-durable'
import { BRANCH_KIND, lineIdFor, toItems, type Item } from './sessionItems'
import type { SessionFileHeader } from './sessionFile'
import { DURABLE_HEADER_KEY } from './resumeFile'

/**
 * Phase 8.3q: the branches of a session as one JSONL tree.
 *
 * A session that was navigated (`navigate_tree`) is several pi-durable conversations: each branch is
 * a fork, whose history starts with the entries it shares with the branch it came from. They are
 * placed in one tree: an entry shared by several branches is written once, and the first entry a
 * branch adds has the shared entry before it as its parent. That is the shape the SDK writes when a
 * session branches in place, so the sidebar, the session map and the SDK read it as they would any
 * other session. With one conversation the tree is a chain.
 *
 * Line ids come from the entries (`lineIdFor`), not from where a line falls in the file, so they
 * stay put however the tree grows. Lines are written branches oldest first, the active one last.
 */

export interface Placed {
  /** The line's id in the file. */
  lineId: string
  parent: string | null
  item: Item
  /** Which of the given histories contain this line, by index. */
  histories: number[]
  /** For a compaction: the line of the first entry it kept. */
  keptLineId?: string
}

/** Place every history's items in one tree, in the order the lines are written. */
export function placeTree(
  header: SessionFileHeader,
  histories: readonly (readonly EntryRecord[])[]
): Placed[] {
  const placed: Placed[] = []
  const byKey = new Map<string, Placed>()
  histories.forEach((entries, index) => {
    const ordinals = new Map<number, number>()
    const chain: Placed[] = []
    const added: Placed[] = []
    for (const item of toItems(header, entries)) {
      // One entry can be several lines (a rename and a message); count them per entry.
      const ordinal = ordinals.get(item.source) ?? 0
      ordinals.set(item.source, ordinal + 1)
      const key = `${item.source}#${ordinal}`
      let node = byKey.get(key)
      if (!node) {
        node = {
          lineId: lineIdFor(item.source, ordinal),
          parent: chain.at(-1)?.lineId ?? null,
          item,
          histories: [],
        }
        placed.push(node)
        byKey.set(key, node)
        added.push(node)
      }
      node.histories.push(index)
      chain.push(node)
    }
    for (const node of added) {
      if (node.item.type !== 'compaction') continue
      // `head` may name an entry that wrote no line, so take the next one that did in this branch.
      // With none, the compaction keeps nothing and names itself, as the SDK does.
      const kept = chain.find((c) => c.item.source >= (node.item.keepFrom ?? Infinity))
      node.keptLineId = kept?.lineId ?? node.lineId
    }
  })
  return placed
}

/** Pure: JSONL v3 text for the histories (oldest branch first, the active one last). */
export function renderSessionTree(
  header: SessionFileHeader,
  histories: readonly (readonly EntryRecord[])[]
): { text: string; messages: number } {
  const placed = placeTree(header, histories)
  const first: Record<string, unknown> = {
    type: 'session',
    version: 3,
    id: header.sessionId,
    timestamp: header.startedAt,
    cwd: header.cwd,
  }
  // Where the store is, so a restart can reopen the session; absent on a file the SDK wrote. The
  // line count and the last id are not passed in: they are what this export is about to write, and
  // a resume compares them to tell whether the file was changed since (`resumeFile.ts`).
  if (header.durable) {
    first[DURABLE_HEADER_KEY] = {
      ...header.durable,
      lines: placed.length,
      lastLineId: placed.at(-1)?.lineId ?? header.sessionId,
    }
  }
  const lines: string[] = [JSON.stringify(first)]
  for (const node of placed) {
    const body = { ...node.item.body }
    if (node.keptLineId !== undefined) body.firstKeptEntryId = node.keptLineId
    lines.push(
      JSON.stringify({
        type: node.item.type,
        id: node.lineId,
        parentId: node.parent,
        timestamp: node.item.timestamp,
        ...body,
      })
    )
  }
  return {
    text: `${lines.join('\n')}\n`,
    messages: placed.filter((node) => node.item.type === 'message').length,
  }
}

/**
 * The line a renderer id names, among the placed lines.
 *
 * Line ids are the file's own. The renderer only knows a message by a synthetic id (`u-{ms}` /
 * `a-{ms}`: role and timestamp) until it next reads the file, which is every message of the current
 * session; those are matched on role and timestamp. Two messages of one role can share a timestamp
 * (pi-durable places a steer and a follow-up in one commit), and then the id does not say which is
 * meant: that is an error, never a guess.
 */
export function findLine(
  placed: readonly Placed[],
  lineId: string,
  action: 'fork' | 'navigate' = 'fork'
): Placed | undefined {
  const direct = placed.find((node) => node.lineId === lineId)
  if (direct) return direct
  const synthetic = /^[ua]-(-?\d+)$/.exec(lineId)
  if (!synthetic) return undefined
  const at = Number(synthetic[1])
  const role = lineId.startsWith('u') ? 'user' : 'assistant'
  const matches = placed.filter(
    (node) => node.item.role === role && Date.parse(node.item.timestamp) === at
  )
  if (matches.length > 1) {
    throw new Error(
      `Cannot ${action}: ${lineId} is ambiguous, ${matches.length} ${role} messages were sent at the same moment`
    )
  }
  return matches[0]
}

/** `findLine` over histories that have not been placed yet. */
export function resolveLine(
  header: SessionFileHeader,
  histories: readonly (readonly EntryRecord[])[],
  lineId: string
): Placed | undefined {
  return findLine(placeTree(header, histories), lineId)
}

/**
 * The last line of one history's branch that is a place to continue from: where its next message
 * attaches. The marker that opens a navigated branch is not one.
 */
export function leafOf(placed: readonly Placed[], index: number): Placed | undefined {
  return placed.filter((node) => node.histories.includes(index) && !isBranchMarker(node)).at(-1)
}

export function isBranchMarker(node: Placed): boolean {
  return node.item.type === 'custom' && node.item.body.customType === BRANCH_KIND
}
