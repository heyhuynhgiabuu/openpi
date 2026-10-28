import type { AssistantMessage, UserMessage } from '@earendil-works/pi-ai'
import { describe, expect, it } from 'vitest'
import type { EntryRecord } from '../electron/pi/durable/wire'
import { lineIdFor } from '../electron/pi/durable/sessionItems'
import { resolveLineEntry } from '../electron/pi/durable/sessionFile'
import { assistant, conversationId, entryId } from './helpers/wireEvents'

/**
 * Phase 8.3p: the id the renderer holds for a message must resolve to that message or to nothing.
 * A wrong fork point silently starts a different conversation.
 */

const header = { sessionId: 's', cwd: '/w', startedAt: '2026-10-27T00:00:00.000Z' }

function user(id: number, text: string, timestamp: number): EntryRecord {
  const message: UserMessage = { role: 'user', content: text, timestamp }
  return { id: entryId(id), conversationId: conversationId(1), kind: 'pi.user', model: [message] }
}

function reply(id: number, text: string, timestamp: number): EntryRecord {
  const message: AssistantMessage = { ...assistant(text), timestamp }
  return {
    id: entryId(id),
    conversationId: conversationId(1),
    kind: 'pi.assistant',
    model: [message],
  }
}

describe('resolveLineEntry', () => {
  // Entry ids are not dense in pi-durable; a line's id comes from its entry, not its position.
  const entries = [user(7, 'q1', 1000), reply(10, 'a1', 2000), user(11, 'q2', 3000)]

  it('resolves a line id to the entry behind that line', () => {
    expect(resolveLineEntry(header, entries, lineIdFor(entryId(7), 0))).toBe(7)
    expect(resolveLineEntry(header, entries, lineIdFor(entryId(10), 0))).toBe(10)
    expect(resolveLineEntry(header, entries, lineIdFor(entryId(11), 0))).toBe(11)
  })

  it('resolves a synthetic id by role and timestamp', () => {
    expect(resolveLineEntry(header, entries, 'u-3000')).toBe(11)
    expect(resolveLineEntry(header, entries, 'a-2000')).toBe(10)
  })

  it('does not resolve a synthetic id to a message of the other role at the same moment', () => {
    const tied = [user(7, 'q1', 1000), reply(10, 'a1', 2000), user(11, 'q2', 2000)]
    expect(resolveLineEntry(header, tied, 'a-2000')).toBe(10)
    expect(resolveLineEntry(header, tied, 'u-2000')).toBe(11)
  })

  it('refuses a synthetic id that names two messages of one role', () => {
    const steered = [
      user(7, 'q1', 1000),
      reply(10, 'a1', 2000),
      user(11, 'steer', 3000),
      user(12, 'follow-up', 3000),
    ]
    expect(() => resolveLineEntry(header, steered, 'u-3000')).toThrow(/ambiguous, 2 user messages/)
  })

  it('finds nothing for an unknown id', () => {
    expect(resolveLineEntry(header, entries, 'deadbeef')).toBeUndefined()
    expect(resolveLineEntry(header, entries, 'u-999')).toBeUndefined()
    expect(resolveLineEntry(header, entries, 'x-3000')).toBeUndefined()
  })
})
