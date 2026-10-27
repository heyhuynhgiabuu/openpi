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
