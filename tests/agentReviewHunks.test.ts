import { describe, expect, it } from 'vitest'
import {
  computeReviewHunks,
  keepHunkInBefore,
  revertHunkInAfter,
  type ReviewHunk,
} from '../electron/services/agentReviewDiff'

const before = 'alpha\nbeta\ngamma\ndelta\nepsilon\nzeta\neta\n'

/** Applies every hunk in order to one side, as repeated user actions would. */
function applyAll(content: string, side: 'before' | 'after'): string {
  let current = content
  for (;;) {
    const hunks = computeReviewHunks(
      side === 'before' ? current : before,
      side === 'before' ? after : current
    )
    const hunk = hunks[0]
    if (!hunk) return current
    current = side === 'before' ? keepHunkInBefore(current, hunk) : revertHunkInAfter(current, hunk)
  }
}

const after = 'alpha\nBETA\ngamma\ndelta\nepsilon\nZETA\neta\n'

describe('review hunk math', () => {
  it('reports no hunks for identical content', () => {
    expect(computeReviewHunks(before, before)).toEqual([])
  })

  it('splits separated changes into one hunk each', () => {
    const hunks = computeReviewHunks(before, after)

    expect(hunks).toHaveLength(2)
    expect(hunks[0]).toMatchObject({
      index: 0,
      beforeStart: 2,
      afterStart: 2,
      added: 1,
      removed: 1,
    })
    expect(hunks[0]?.beforeLines).toEqual(['beta'])
    expect(hunks[0]?.afterLines).toEqual(['BETA'])
    expect(hunks[1]).toMatchObject({
      index: 1,
      beforeStart: 6,
      afterStart: 6,
      added: 1,
      removed: 1,
    })
    expect(hunks[1]?.beforeLines).toEqual(['zeta'])
    expect(hunks[1]?.afterLines).toEqual(['ZETA'])
  })

  it('anchors an insertion at the line it lands before', () => {
    const [hunk] = computeReviewHunks('a\nc\n', 'a\nb\nc\n')

    expect(hunk).toMatchObject({ beforeStart: 2, afterStart: 2, added: 1, removed: 0 })
    expect(hunk?.beforeLines).toEqual([])
    expect(hunk?.afterLines).toEqual(['b'])
  })

  it('anchors a deletion at the line it removes', () => {
    const [hunk] = computeReviewHunks('a\nb\nc\n', 'a\nc\n')

    expect(hunk).toMatchObject({ beforeStart: 2, afterStart: 2, added: 0, removed: 1 })
    expect(hunk?.beforeLines).toEqual(['b'])
    expect(hunk?.afterLines).toEqual([])
  })

  it('keeps changes at the file edges', () => {
    const hunks = computeReviewHunks('one\nmid\ntail\n', 'ONE\nmid\nTAIL\n')

    expect(hunks).toHaveLength(2)
    expect(hunks[0]).toMatchObject({ beforeStart: 1, afterStart: 1 })
    expect(hunks[1]).toMatchObject({ beforeStart: 3, afterStart: 3 })
  })

  it('keeping every hunk turns the baseline into the current file', () => {
    expect(applyAll(before, 'before')).toBe(after)
  })

  it('reverting every hunk turns the current file back into the baseline', () => {
    expect(applyAll(after, 'after')).toBe(before)
  })

  it('applies a single hunk without touching the others', () => {
    const hunks = computeReviewHunks(before, after)
    const first = hunks[0] as ReviewHunk

    expect(keepHunkInBefore(before, first)).toBe('alpha\nBETA\ngamma\ndelta\nepsilon\nzeta\neta\n')
    expect(revertHunkInAfter(after, first)).toBe('alpha\nbeta\ngamma\ndelta\nepsilon\nZETA\neta\n')
  })

  it('round-trips a hunk through keep and revert', () => {
    const [hunk] = computeReviewHunks(before, after)
    const kept = keepHunkInBefore(before, hunk as ReviewHunk)
    const reverted = revertHunkInAfter(kept, hunk as ReviewHunk)

    expect(reverted).toBe(before)
  })
})
