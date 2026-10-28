import type { Message } from '@earendil-works/pi-ai'
import { describe, expect, it } from 'vitest'
import { createCompactionTracker } from '../electron/pi/durable/wireCompaction'

const user = (text: string): Message => ({ role: 'user', content: text, timestamp: 0 })
const WRAPPED = user(
  'The conversation history before this point was compacted into the following summary:\n\n<summary>\nS\n</summary>'
)

describe('compaction tracker', () => {
  it('withholds the wrapped summary only while a compaction is open', () => {
    const tracker = createCompactionTracker()
    expect(tracker.swallowStart(WRAPPED)).toBe(false)
    tracker.begin()
    expect(tracker.swallowStart(WRAPPED)).toBe(true)
    tracker.end('manual', undefined)
    expect(tracker.swallowStart(WRAPPED)).toBe(false)
  })

  it('still shows a real user message that arrives while the compaction runs', () => {
    const tracker = createCompactionTracker()
    tracker.begin()
    expect(tracker.swallowStart(user('a steer from the user'))).toBe(false)
  })

  it('reports an error end as an error, never as a result', () => {
    const tracker = createCompactionTracker()
    tracker.begin()
    expect(tracker.end('manual', 'provider down')).toMatchObject({
      errorMessage: 'provider down',
    })
  })
})
