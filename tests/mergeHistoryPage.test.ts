import { describe, expect, it } from 'vitest'
import { mergeHistoryPage } from '../src/hooks/useSessionHistory'
import type { Message } from '../src/types/session'

/**
 * Issue #71. A history load is async, so the live event stream can add messages
 * while the read is in flight. Replacing the list lost them; concatenating both
 * would show a message twice whenever it was in the page as well.
 */

const user = (id: string, text: string, timestamp?: number): Message => ({
  id,
  role: 'user',
  text,
  toolCards: [],
  timestamp,
})

const assistant = (id: string, text: string, timestamp?: number): Message => ({
  id,
  role: 'assistant',
  text,
  toolCards: [],
  timestamp,
})

const system = (id: string): Message => ({
  id,
  role: 'system',
  kind: 'retry',
  text: 'retrying',
  done: true,
})

const ids = (messages: Message[]) => messages.map((message) => message.id)

describe('merging a history page with live messages (#71)', () => {
  it('keeps a live message the page does not contain', () => {
    const merged = mergeHistoryPage(
      [user('entry-1', 'from file', 1_000)],
      [assistant('a-2000', 'live output', 2_000)]
    )

    expect(ids(merged)).toEqual(['entry-1', 'a-2000'])
  })

  it('keeps the file copy, not a second copy, when both hold the same message', () => {
    // The window: message_end was emitted live, and the append landed before the
    // read ran, so the page carries it too. Ids differ by construction.
    const merged = mergeHistoryPage(
      [user('entry-1', 'hello', 1_000)],
      [user('u-1000', 'hello', 1_000)]
    )

    expect(ids(merged)).toEqual(['entry-1'])
  })

  it('tells two messages apart when only their role differs', () => {
    // A user prompt and the assistant reply can share a millisecond.
    const merged = mergeHistoryPage(
      [assistant('entry-2', 'reply', 1_000)],
      [user('u-1000', 'ask', 1_000)]
    )

    expect(ids(merged)).toEqual(['entry-2', 'u-1000'])
  })

  it('keeps live messages that carry no timestamp', () => {
    // `timestamp` is optional live (the renderer falls back to Date.now()), so a
    // message without one cannot be matched against the file. It arrived after
    // the read started, so keeping it is the lesser harm.
    const merged = mergeHistoryPage(
      [user('entry-1', 'hello', 1_000)],
      [assistant('a-1', 'streamed')]
    )

    expect(ids(merged)).toEqual(['entry-1', 'a-1'])
  })

  it('always keeps system and extension messages, which the file cannot hold', () => {
    const merged = mergeHistoryPage([user('entry-1', 'hello', 1_000)], [system('sys-1')])

    expect(ids(merged)).toEqual(['entry-1', 'sys-1'])
  })

  it('preserves live order after the page', () => {
    const merged = mergeHistoryPage(
      [user('entry-1', 'a', 1_000)],
      [assistant('a-2', 'b', 2_000), system('sys-1'), user('u-3', 'c', 3_000)]
    )

    expect(ids(merged)).toEqual(['entry-1', 'a-2', 'sys-1', 'u-3'])
  })

  it('returns the page unchanged when nothing arrived live', () => {
    const page = [user('entry-1', 'a', 1_000), assistant('entry-2', 'b', 2_000)]

    expect(mergeHistoryPage(page, [])).toEqual(page)
  })
})
