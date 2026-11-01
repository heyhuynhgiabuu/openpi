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

const card = (toolCallId: string, output: string, streaming = false) => ({
  toolCallId,
  toolName: 'bash',
  args: {},
  output,
  isError: false,
  streaming,
})

const assistantWith = (id: string, timestamp: number, toolCards: ReturnType<typeof card>[]) => ({
  ...assistant(id, '', timestamp),
  toolCards,
})

describe('merging a history page with live messages (#71)', () => {
  it('keeps the live tool output when the file copy of the same message is stale (#76)', () => {
    // The file copy is the message of record (its entry id is what fork and branch need), but it
    // carries the tool card as the JSONL had it at read time: `output: ''`, `streaming: false`.
    // If the read lands after the tool ended and before the result was written, keeping the file
    // copy verbatim throws that output away -- and nothing re-reads history on `agent_end`.
    const fromFile = assistantWith('entry-1', 1_000, [card('call-1', '', false)])
    const live = assistantWith('a-1', 1_000, [card('call-1', 'DURABLE_E2E_MARKER', true)])

    const [merged] = mergeHistoryPage([fromFile], [live])

    expect(merged?.id).toBe('entry-1')
    expect(merged?.role === 'assistant' ? merged.toolCards[0]?.output : null).toBe(
      'DURABLE_E2E_MARKER'
    )
  })

  it('keeps the file copy own output when it already has one', () => {
    // Only an empty file-side card defers to the live one: a file copy with output is the
    // authoritative record, and the live stream may be a partial that ended abruptly.
    const fromFile = assistantWith('entry-1', 1_000, [card('call-1', 'from file', false)])
    const live = assistantWith('a-1', 1_000, [card('call-1', 'different', true)])

    const [merged] = mergeHistoryPage([fromFile], [live])

    expect(merged?.role === 'assistant' ? merged.toolCards[0]?.output : null).toBe('from file')
  })

  it('takes streaming and startedAt from the live card so an in-flight tool still looks live', () => {
    const fromFile = assistantWith('entry-1', 1_000, [card('call-1', '', false)])
    const live = {
      ...assistantWith('a-1', 1_000, [card('call-1', '', true)]),
      toolCards: [{ ...card('call-1', '', true), startedAt: 9_000 }],
    }

    const [merged] = mergeHistoryPage([fromFile], [live])
    const cards = merged?.role === 'assistant' ? merged.toolCards : []

    expect(cards[0]?.streaming).toBe(true)
    expect(cards[0]?.startedAt).toBe(9_000)
  })

  it('takes the error flag even when the failed tool produced no output', () => {
    // A tool that throws with no message ends with `output: ''` and `isError: true`. Copying the
    // output only when it is non-empty therefore left the file card reading as a SUCCESS until a
    // reload -- and nothing re-reads history on `agent_end`. Wrong, not merely stale.
    const fromFile = assistantWith('entry-1', 1_000, [card('call-1', '', false)])
    const live = assistantWith('a-1', 1_000, [{ ...card('call-1', '', false), isError: true }])

    const [merged] = mergeHistoryPage([fromFile], [live])
    const cards = merged?.role === 'assistant' ? merged.toolCards : []

    expect(cards[0]?.isError).toBe(true)
  })

  it('keeps a recorded error when the live card has not ended yet', () => {
    // The live list can lag the file. Without the ended-check on the error carry, a file record
    // that already says "failed" would be flipped back to success by a card still streaming.
    const fromFile = assistantWith('entry-1', 1_000, [
      { ...card('call-1', '', false), isError: true },
    ])
    const live = assistantWith('a-1', 1_000, [{ ...card('call-1', '', true), isError: false }])

    const [merged] = mergeHistoryPage([fromFile], [live])
    const cards = merged?.role === 'assistant' ? merged.toolCards : []

    expect(cards[0]?.isError).toBe(true)
  })

  it('never marks a file card streaming when it already holds the final output', () => {
    // The tool row hides the output of a streaming card, so copying `streaming` onto a finished
    // card made the final result disappear until the end event happened to arrive.
    const fromFile = assistantWith('entry-1', 1_000, [card('call-1', 'FINAL', false)])
    const live = assistantWith('a-1', 1_000, [card('call-1', 'FINAL', true)])

    const [merged] = mergeHistoryPage([fromFile], [live])
    const cards = merged?.role === 'assistant' ? merged.toolCards : []

    expect(cards[0]?.streaming).toBe(false)
    expect(cards[0]?.output).toBe('FINAL')
  })

  it('leaves a card with no live counterpart alone', () => {
    const fromFile = assistantWith('entry-1', 1_000, [
      card('call-1', '', false),
      card('call-2', 'kept', false),
    ])
    const live = assistantWith('a-1', 1_000, [card('call-1', 'filled', true)])

    const [merged] = mergeHistoryPage([fromFile], [live])
    const cards = merged?.role === 'assistant' ? merged.toolCards : []

    expect(cards.map((entry) => entry.output)).toEqual(['filled', 'kept'])
  })

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

describe('the (role, timestamp) key is what matches, not the text (#71)', () => {
  it('matches a page message whose text differs from the live card', () => {
    // The live assistant text is partial while streaming; the file copy is final.
    // Matching on text would fail here and show the message twice.
    const merged = mergeHistoryPage(
      [assistant('entry-1', 'the full answer', 5_000)],
      [assistant('a-5000', 'the ful', 5_000)]
    )

    expect(merged.map((message) => message.id)).toEqual(['entry-1'])
  })

  it('does not treat two messages as one just because they have no timestamp', () => {
    const merged = mergeHistoryPage([user('entry-1', 'from file')], [user('u-1', 'from file')])

    expect(merged.map((message) => message.id)).toEqual(['entry-1', 'u-1'])
  })
})
