import { describe, expect, it } from 'vitest'
import { applySessionEvent, formatCompactionEndText } from '../src/lib/sessionEvents'

describe('compaction event rendering', () => {
  it('describes tokensBefore as the pre-compaction context size', () => {
    expect(formatCompactionEndText({ result: { tokensBefore: 272_792 } })).toBe(
      'Compacted from 272,792 tokens'
    )
  })

  it('updates an in-progress compaction system message with accurate completed text', () => {
    const started = applySessionEvent([], { type: 'compaction_start', reason: 'threshold' })
    const completed = applySessionEvent(started, {
      type: 'compaction_end',
      reason: 'threshold',
      aborted: false,
      willRetry: false,
      result: { tokensBefore: 272_792, summary: 'Summarized prior work.' },
    })

    expect(completed).toHaveLength(1)
    expect(completed[0]).toMatchObject({
      role: 'system',
      kind: 'compaction',
      done: true,
      text: 'Compacted from 272,792 tokens',
    })
  })

  it('renders aborted and failed compactions distinctly', () => {
    expect(formatCompactionEndText({ aborted: true })).toBe('Context compaction aborted')
    expect(formatCompactionEndText({ errorMessage: 'provider unavailable', willRetry: true })).toBe(
      'Context compaction failed — will retry: provider unavailable'
    )
  })
})
