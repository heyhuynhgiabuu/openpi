import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '../src/lib/ipc'
import { applySessionEvent, formatCompactionEndText } from '../src/lib/sessionEvents'
import type { Message, ToolCard } from '../src/types/session'
import {
  CODEMODE_CALL_ID,
  CODEMODE_RESULT_TEXT,
  codemodeToolEvents,
  codemodeTurnEvents,
  parseEvents,
} from './helpers/nestedToolEvents'

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

describe('extension error rendering', () => {
  it('surfaces an extension load failure as a done system message', () => {
    const messages = applySessionEvent([], {
      type: 'extension_error',
      extensionPath: '/ws/.pi/extensions/broken.js',
      event: 'load',
      error: 'Extension does not export a valid factory function: broken.js',
    })

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      role: 'system',
      kind: 'extension',
      done: true,
      text: 'Extension issue: /ws/.pi/extensions/broken.js — Extension does not export a valid factory function: broken.js',
    })
  })

  it('names the extension when only the path is known', () => {
    const messages = applySessionEvent([], { type: 'extension_error', extensionPath: '/x/y.js' })
    expect(messages[0]).toMatchObject({
      role: 'system',
      kind: 'extension',
      text: 'Extension issue: /x/y.js — error',
    })
  })
})

/**
 * Pi codemode (`ctx.executeTool`) emits extra tool events for the script's
 * nested calls: child ids `<callId>/<n>`, every event carries `parentToolCallId`.
 * The transcript never holds those calls (Pi docs, extensions.md "nested
 * calls"), so a resumed session shows only the codemode card. The live fold
 * must agree, or the tool rail changes shape the moment history reloads.
 */
describe('nested tool events (codemode)', () => {
  const fold = (events: SessionEvent[], from: Message[] = []): Message[] =>
    events.reduce<Message[]>((messages, event) => applySessionEvent(messages, event), from)
  const assistantWithCall = (): Message[] =>
    fold(parseEvents([{ type: 'message_start', message: { role: 'assistant', timestamp: 1 } }]))
  const cardsOf = (messages: Message[]): ToolCard[] =>
    messages.flatMap((message) => ('toolCards' in message ? message.toolCards : []))

  it('keeps exactly one top-level card for a codemode run with a nested write', () => {
    const cards = cardsOf(fold(codemodeTurnEvents()))

    expect(cards.map((card) => card.toolCallId)).toEqual([CODEMODE_CALL_ID])
    expect(cards[0]?.toolName).toBe('codemode')
  })

  it('moves the codemode card start → running → ended while its nested call runs', () => {
    const tool = codemodeToolEvents()
    const [start, running, nestedStart, nestedEnd, progress, end] = parseEvents([
      tool.start,
      tool.running,
      tool.nestedStart,
      tool.nestedEnd,
      tool.progress,
      tool.end,
    ])
    const parent = (messages: Message[]) =>
      cardsOf(messages).find((card) => card.toolCallId === CODEMODE_CALL_ID)

    let messages = fold([start, running], assistantWithCall())
    expect(parent(messages)).toMatchObject({ streaming: true, output: '', isError: false })

    messages = fold([nestedStart], messages)
    expect(parent(messages)).toMatchObject({ streaming: true, output: '', isError: false })

    // The child finishing, and the script's own progress update, leave the parent running.
    messages = fold([nestedEnd, progress], messages)
    expect(parent(messages)).toMatchObject({ streaming: true, output: '', isError: false })

    messages = fold([end], messages)
    expect(parent(messages)).toMatchObject({
      streaming: false,
      isError: false,
      output: CODEMODE_RESULT_TEXT,
    })
  })

  it('does not mark the codemode card failed because a nested call failed', () => {
    const tool = codemodeToolEvents()
    const failedChild = { ...tool.nestedEnd, isError: true }
    const events = parseEvents([tool.start, tool.nestedStart, failedChild, tool.end])
    const messages = fold(events, assistantWithCall())

    expect(cardsOf(messages).find((card) => card.toolCallId === CODEMODE_CALL_ID)).toMatchObject({
      isError: false,
      streaming: false,
    })
  })

  it('keeps parallel codemode calls apart even when one id prefixes the other', () => {
    const first = codemodeToolEvents('call_1')
    const second = codemodeToolEvents('call_10')
    const events = parseEvents([
      first.start,
      second.start,
      first.nestedStart,
      second.nestedStart,
      second.nestedEnd,
      first.nestedEnd,
      second.end,
    ])
    const cards = cardsOf(fold(events, assistantWithCall()))

    expect(cards.map((card) => [card.toolCallId, card.streaming])).toEqual([
      ['call_1', true],
      ['call_10', false],
    ])
  })

  it('never lets a nested id reach a card or a message id, at any depth', () => {
    const tool = codemodeToolEvents()
    const grandchildStart = {
      ...tool.nestedStart,
      toolCallId: `${CODEMODE_CALL_ID}/1/1`,
      parentToolCallId: `${CODEMODE_CALL_ID}/1`,
    }
    const messages = fold(
      parseEvents([tool.start, tool.nestedStart, grandchildStart]),
      assistantWithCall()
    )

    const ids = [...messages.map((m) => m.id), ...cardsOf(messages).map((c) => c.toolCallId)]
    expect(ids.filter((id) => id.includes('/'))).toEqual([])
  })

  it('returns the same array for nested events, so memoized consumers skip the update', () => {
    const tool = codemodeToolEvents()
    const [start, nestedStart, nestedUpdate, nestedEnd] = parseEvents([
      tool.start,
      tool.nestedStart,
      { ...tool.nestedStart, type: 'tool_execution_update', partialResult: { content: [] } },
      tool.nestedEnd,
    ])
    const running = fold([start], assistantWithCall())

    for (const event of [nestedStart, nestedUpdate, nestedEnd]) {
      expect(applySessionEvent(running, event)).toBe(running)
    }
  })
})

/**
 * Live user/assistant cards must carry `message.timestamp`: it is the only value a history load can
 * match against the file, since ids differ (`entry.id` vs `u-`/`a-<ts>`). Without it, every message
 * would be duplicated by the merge instead of recognised.
 */
describe('live cards carry the message timestamp', () => {
  const fold = (events: SessionEvent[]): Message[] =>
    events.reduce<Message[]>((messages, event) => applySessionEvent(messages, event), [])

  it('stamps a user card', () => {
    const messages = fold([
      {
        type: 'message_start',
        message: { role: 'user', content: 'hi', timestamp: 1_700_000_000_000 },
      },
    ])
    const user = messages.find((message) => message.role === 'user')

    expect(user?.role === 'user' ? user.timestamp : undefined).toBe(1_700_000_000_000)
  })

  it('stamps an assistant card', () => {
    const messages = fold([
      { type: 'message_start', message: { role: 'assistant', timestamp: 1_700_000_001_000 } },
    ])
    const card = messages.find((message) => message.role === 'assistant')

    expect(card?.role === 'assistant' ? card.timestamp : undefined).toBe(1_700_000_001_000)
  })
})

/**
 * A call can already have a card when its start arrives: history builds one for every call in the
 * last assistant message, and on a reopen a call that was still running ends without ever having
 * been started in the new feed. Appending blindly showed the same call twice — the bug a reviewer
 * found by driving that path, which no unit test reached before.
 */
describe('a tool start for a call that already has a card', () => {
  const fold = (events: SessionEvent[], from: Message[] = []): Message[] =>
    events.reduce<Message[]>((messages, event) => applySessionEvent(messages, event), from)
  const cardsOf = (messages: Message[]): ToolCard[] =>
    messages.flatMap((message) => ('toolCards' in message ? message.toolCards : []))

  /**
   * The shape a history load leaves: the call is a card on the last assistant message, with its real
   * arguments. History builds cards `streaming:false` with no `startedAt`; the fields this test does
   * not exercise are left as they were rather than faked precisely.
   */
  const loaded = (): Message[] =>
    fold(
      parseEvents([{ type: 'message_start', message: { role: 'assistant', timestamp: 1 } }])
    ).map((message) =>
      'toolCards' in message
        ? {
            ...message,
            toolCards: [
              {
                toolCallId: 'call-1',
                toolName: 'bash',
                args: { command: 'sleep 5' },
                output: '',
                isError: false,
                streaming: true,
                startedAt: 1,
              },
            ],
          }
        : message
    )

  it('still gives two parallel calls their own cards when the id is empty', () => {
    // A provider that sends no tool-call id gives every call `""`. Collapsing them would hide the
    // refusal behind a different call's card, which is worse than the duplicate this fix removes.
    const starts = parseEvents([
      { type: 'tool_execution_start', toolCallId: '', toolName: 'bash', args: { command: 'ls' } },
      {
        type: 'tool_execution_start',
        toolCallId: '',
        toolName: 'bash',
        args: { command: 'rm -rf /tmp/x' },
      },
    ])
    const cards = cardsOf(
      fold(
        starts,
        fold(parseEvents([{ type: 'message_start', message: { role: 'assistant', timestamp: 1 } }]))
      )
    )
    expect(cards.map((card) => card.args.command)).toEqual(['ls', 'rm -rf /tmp/x'])
  })

  it('keeps one card and does not append a second for the same call', () => {
    const [start] = parseEvents([
      { type: 'tool_execution_start', toolCallId: 'call-1', toolName: 'bash', args: {} },
    ])
    const cards = cardsOf(fold([start], loaded()))
    expect(cards).toHaveLength(1)
    // The history card keeps its real arguments; the synthetic start must not blank them.
    expect(cards[0]).toMatchObject({ toolCallId: 'call-1', args: { command: 'sleep 5' } })
  })
})
