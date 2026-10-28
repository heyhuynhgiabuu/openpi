import type { UserMessage } from '@earendil-works/pi-ai'
import { describe, expect, it } from 'vitest'
import { lineIdFor } from '../electron/pi/durable/sessionItems'
import { leafOf, placeTree } from '../electron/pi/durable/sessionTree'
import type { EntryRecord } from '../electron/pi/durable/wire'
import { assistant, conversationId, entryId } from './helpers/wireEvents'

/**
 * Phase 8.3q: the exported tree of a session's branches. The properties that matter to a reader
 * that already holds line ids: an id never moves, a shared entry is one line, and a branch hangs
 * off the line it was forked at.
 */

const header = { sessionId: 's', cwd: '/w', startedAt: '2026-10-27T00:00:00.000Z' }

function user(id: number, text: string): EntryRecord {
  const message: UserMessage = { role: 'user', content: text, timestamp: id * 1000 }
  return { id: entryId(id), conversationId: conversationId(1), kind: 'pi.user', model: [message] }
}

function reply(id: number, text: string): EntryRecord {
  return {
    id: entryId(id),
    conversationId: conversationId(1),
    kind: 'pi.assistant',
    model: [{ ...assistant(text), timestamp: id * 1000 }],
  }
}

// Branch A: q1 a1 q2 a2.  Branch B forks A after a1: q1 a1 then its own q3 a3.
const shared = [user(7, 'q1'), reply(10, 'a1')]
const branchA = [...shared, user(11, 'q2'), reply(14, 'a2')]
const branchB = [...shared, user(21, 'q3'), reply(24, 'a3')]

const idsOf = (placed: ReturnType<typeof placeTree>) =>
  Object.fromEntries(placed.map((node) => [node.item.source, node.lineId]))

describe('placeTree', () => {
  it('writes an entry shared by branches once, and hangs a branch off its fork point', () => {
    const placed = placeTree(header, [branchA, branchB])
    expect(placed.map((node) => Number(node.item.source))).toEqual([7, 10, 11, 14, 21, 24])
    const byId = new Map(placed.map((node) => [Number(node.item.source), node]))
    expect(byId.get(7)?.parent).toBeNull()
    expect(byId.get(21)?.parent).toBe(byId.get(10)?.lineId)
    expect(byId.get(11)?.parent).toBe(byId.get(10)?.lineId)
  })

  it('derives ids from the entries, so they do not move when another branch appears', () => {
    const alone = idsOf(placeTree(header, [branchA]))
    const withBranch = idsOf(placeTree(header, [branchA, branchB]))
    for (const source of [7, 10, 11, 14]) expect(withBranch[source]).toBe(alone[source])
    expect(alone[7]).toBe(lineIdFor(entryId(7), 0))
  })

  it('keeps every id when an abandoned branch grows after another branch has lines', () => {
    const before = idsOf(placeTree(header, [branchA, branchB]))
    // A late entry (a compaction finishing) lands on branch A, which is written first.
    const grown = [...branchA, reply(30, 'late')]
    const after = idsOf(placeTree(header, [grown, branchB]))
    for (const source of [7, 10, 11, 14, 21, 24]) expect(after[source]).toBe(before[source])
    expect(after[30]).toBeDefined()
  })

  it('is the same wherever the histories are read from, and needs no branch order for ids', () => {
    const forward = idsOf(placeTree(header, [branchA, branchB]))
    const reversed = idsOf(placeTree(header, [branchB, branchA]))
    expect(reversed).toEqual(forward)
  })
})

describe('leafOf', () => {
  it('is the last line of the branch, not of the file', () => {
    const placed = placeTree(header, [branchA, branchB])
    expect(Number(leafOf(placed, 0)?.item.source)).toBe(14)
    expect(Number(leafOf(placed, 1)?.item.source)).toBe(24)
  })
})
