import { describe, expect, it } from 'vitest'
import { DURABLE_HEADER_KEY, readResumeTarget } from '../electron/pi/durable/resumeFile'
import { renderSessionTree } from '../electron/pi/durable/sessionTree'

/**
 * Phase 8.4a: the durable marker on a session file's header, which is what lets a restart find the
 * store behind the session. Both readings matter: ours, and the SDK's on a file it did not write.
 */

const header = { sessionId: 'sess-1', cwd: '/work', startedAt: '2026-10-27T00:00:00.000Z' }
const durable = { storeId: 'store-1', conversationIds: [1, 7] }

const line = (value: unknown) => `${JSON.stringify(value)}\n`

describe('durable session file header', () => {
  it('round-trips the store id and the conversations through the export', () => {
    const { text } = renderSessionTree({ ...header, durable }, [[]])
    expect(JSON.parse(text.split('\n')[0])).toMatchObject({
      type: 'session',
      version: 3,
      id: 'sess-1',
      timestamp: header.startedAt,
      cwd: '/work',
      [DURABLE_HEADER_KEY]: durable,
    })
    expect(readResumeTarget(text)).toEqual({
      sessionId: header.sessionId,
      startedAt: header.startedAt,
      ...durable,
    })
  })

  it('says nothing about a store when the session is not durable', () => {
    const { text } = renderSessionTree(header, [[]])
    expect(text.split('\n')[0]).not.toContain(DURABLE_HEADER_KEY)
    expect(readResumeTarget(text)).toBeUndefined()
  })

  it('refuses a marker it cannot fully trust, rather than guessing at a store', () => {
    const base = { type: 'session', version: 3, id: 'sess-1', timestamp: header.startedAt }
    for (const marker of [
      { storeId: '', conversationIds: [1] },
      { storeId: 'store-1' },
      { storeId: 'store-1', conversationIds: [1, 0] },
      { storeId: 'store-1', conversationIds: ['1'] },
      { storeId: 'store-1', conversationIds: [1], extra: true },
      'store-1',
    ]) {
      expect(readResumeTarget(line({ ...base, [DURABLE_HEADER_KEY]: marker }))).toBeUndefined()
    }
  })

  it('is not a durable file when the header itself is not a v3 session', () => {
    expect(readResumeTarget('')).toBeUndefined()
    expect(readResumeTarget('not json\n')).toBeUndefined()
    expect(
      readResumeTarget(
        line({ type: 'session', version: 2, id: 's', [DURABLE_HEADER_KEY]: durable })
      )
    ).toBeUndefined()
  })
})
