import { describe, expect, it } from 'vitest'
import { createWireTranslator, type AgentEvent } from '../electron/pi/durable/wire'
import { applySessionEvent } from '../src/lib/sessionEvents'
import { sessionEventSchema } from '../src/lib/ipc'
import type { Message } from '../src/types/session'
import {
  assistant,
  messageEnd,
  schemaFailures,
  submissionId,
  taskId,
  textDeltas,
  translateAll,
} from './helpers/wireEvents'

/**
 * Phase 8.3k: the translator from pi-durable events to the events the renderer reads.
 */

const idle: AgentEvent = { type: 'turn_start' }

describe('run and turn boundaries', () => {
  it('turns run_start/run_end into agent_start/agent_end carrying the run messages', () => {
    const answer = assistant('hi')
    const wire = translateAll([
      { type: 'run_start', inputs: [] },
      idle,
      messageEnd(answer),
      { type: 'turn_end' },
      { type: 'run_end', inputs: [] },
    ])
    expect(wire.map((e) => e.type)).toEqual([
      'agent_start',
      'turn_start',
      // The provider did not stream, so the answer is sent as one delta just before message_end.
      'message_update',
      'message_end',
      'turn_end',
      'agent_end',
      'agent_settled',
    ])
    expect(wire.find((e) => e.type === 'turn_end')).toMatchObject({
      message: answer,
      toolResults: [],
    })
    expect(wire.find((e) => e.type === 'agent_end')).toMatchObject({
      messages: [answer],
      willRetry: false,
    })
    expect(schemaFailures(wire)).toEqual([])
  })

  it('does not settle while something is queued behind the run, then settles after it', () => {
    const translate = createWireTranslator()
    const types = (events: AgentEvent[]) => events.flatMap((e) => translate(e)).map((e) => e.type)
    expect(types([{ type: 'inbox_update', items: [] }])).toEqual(['queue_update'])
    const queued: AgentEvent = {
      type: 'inbox_update',
      items: [{ id: submissionId(5), mode: 'followUp' }],
    }
    expect(
      types([queued, { type: 'run_start', inputs: [] }, { type: 'run_end', inputs: [] }])
    ).toEqual(['queue_update', 'agent_start', 'agent_end'])
    expect(
      types([
        { type: 'inbox_update', items: [] },
        { type: 'run_start', inputs: [] },
        { type: 'run_end', inputs: [] },
      ])
    ).toEqual(['queue_update', 'agent_start', 'agent_end', 'agent_settled'])
  })

  it('reports an aborted run once, and an abort made while idle does not leak into the next run', () => {
    let aborted = true
    const consumeAborted = () => {
      const was = aborted
      aborted = false
      return was
    }
    const wire = translateAll(
      [
        { type: 'run_start', inputs: [] }, // clears the stale flag
        { type: 'run_end', inputs: [] },
      ],
      { consumeAborted }
    )
    expect(wire.find((e) => e.type === 'agent_settled')).toMatchObject({ aborted: false })

    aborted = false
    const during = createWireTranslator({
      consumeAborted: () => {
        const was = aborted
        aborted = false
        return was
      },
    })
    during({ type: 'run_start', inputs: [] })
    aborted = true // the user aborts mid-run
    const end = during({ type: 'run_end', inputs: [] })
    expect(end.find((e) => e.type === 'agent_settled')).toMatchObject({ aborted: true })
  })

  it('drops a turn_end that has no assistant message instead of sending an invalid one', () => {
    expect(translateAll([idle, { type: 'turn_end' }]).map((e) => e.type)).toEqual(['turn_start'])
  })
})

describe('assistant text', () => {
  const start = (text: string): AgentEvent => ({ type: 'message_start', message: assistant(text) })
  const update = (changes: AgentEvent & { type: 'message_update' }): AgentEvent => changes

  it('accumulates streamed deltas into the renderer message and into the reducer', () => {
    const final = assistant('Hello world')
    const wire = translateAll([
      start(''),
      update({
        type: 'message_update',
        usage: final.usage,
        changes: [
          { type: 'text_start', contentIndex: 0, block: { type: 'text', text: '' } },
          { type: 'text_delta', contentIndex: 0, delta: 'Hello ' },
          { type: 'text_delta', contentIndex: 0, delta: 'world' },
        ],
      }),
      messageEnd(final),
    ])
    expect(schemaFailures(wire)).toEqual([])
    const updates = wire.filter((e) => e.type === 'message_update')
    expect(updates).toHaveLength(3)
    expect(updates.at(-1)).toMatchObject({
      message: { content: [{ type: 'text', text: 'Hello world' }] },
    })

    let messages: Message[] = []
    for (const event of wire) {
      const parsed = sessionEventSchema.safeParse(event)
      if (parsed.success) messages = applySessionEvent(messages, parsed.data)
    }
    expect(messages.at(-1)).toMatchObject({ role: 'assistant', text: 'Hello world' })
  })

  it('sends the answer at message_end when the provider never streamed it, exactly once', () => {
    const wire = translateAll([start(''), messageEnd(assistant('whole answer'))])
    expect(textDeltas(wire)).toEqual(['whole answer'])
    expect(wire.at(-1)?.type).toBe('message_end')
    expect(schemaFailures(wire)).toEqual([])
  })

  it('sends only the missing tail when the stream stopped short', () => {
    const wire = translateAll([
      start(''),
      {
        type: 'message_update',
        usage: assistant('').usage,
        changes: [
          { type: 'text_start', contentIndex: 0, block: { type: 'text', text: '' } },
          { type: 'text_delta', contentIndex: 0, delta: 'Hello ' },
        ],
      },
      messageEnd(assistant('Hello world')),
    ])
    expect(textDeltas(wire)).toEqual(['Hello ', 'world'])
  })

  it('does not rewrite the answer when the streamed text diverged from the final one', () => {
    const wire = translateAll([
      start(''),
      {
        type: 'message_update',
        usage: assistant('').usage,
        changes: [
          { type: 'text_start', contentIndex: 0, block: { type: 'text', text: '' } },
          { type: 'text_delta', contentIndex: 0, delta: 'ABC' },
        ],
      },
      messageEnd(assistant('XYZ')),
    ])
    expect(wire.filter((e) => e.type === 'message_update')).toHaveLength(2)
  })
})

describe('other events', () => {
  it('adds the fields the renderer requires to compaction_end', () => {
    const wire = translateAll([
      { type: 'compaction_start', taskId: taskId(1), reason: 'manual', blocking: false },
      { type: 'compaction_end', taskId: taskId(1), reason: 'manual', error: 'summarizer failed' },
      { type: 'compaction_end', taskId: taskId(2), reason: 'threshold' },
    ])
    expect(wire[1]).toMatchObject({
      aborted: false,
      willRetry: false,
      errorMessage: 'summarizer failed',
    })
    // Ended with no failure and no summary entry: nothing was compacted, and it says so.
    expect(wire[2]).toMatchObject({ errorMessage: 'Nothing to compact (session too small)' })
    expect(schemaFailures(wire)).toEqual([])
  })

  it('shapes auto-retry events for the renderer', () => {
    const wire = translateAll([
      { type: 'auto_retry_start', attempt: 2, at: Date.now() + 5_000, errorMessage: 'overloaded' },
      { type: 'auto_retry_end', attempt: 2 },
    ])
    expect(wire[0]).toMatchObject({ attempt: 2, errorMessage: 'overloaded' })
    expect(Number(wire[0]?.delayMs)).toBeGreaterThan(0)
    expect(schemaFailures(wire)).toEqual([])
  })

  it('surfaces a failed task as an extension_error and drops bookkeeping events', () => {
    const wire = translateAll([
      { type: 'task_failed', taskId: taskId(3), kind: 'compaction', message: 'boom' },
      { type: 'deferred_poll', pollAt: 1 },
    ])
    expect(wire).toEqual([
      { type: 'extension_error', extensionPath: 'pi-durable', event: 'compaction', error: 'boom' },
    ])
  })
})

describe('queue updates', () => {
  const texts = new Map([
    [1, 'steer me'],
    [2, 'then follow up'],
  ])
  const queuedText = (id: number) => texts.get(id)
  const inbox = (items: { id: number; mode: 'steer' | 'followUp' | 'write' }[]): AgentEvent => ({
    type: 'inbox_update',
    items: items.map((item) => ({ id: submissionId(item.id), mode: item.mode })),
  })

  it('shows pending messages as text, split by mode', () => {
    const wire = translateAll(
      [
        inbox([
          { id: 1, mode: 'steer' },
          { id: 2, mode: 'followUp' },
        ]),
      ],
      { queuedText }
    )
    expect(wire).toEqual([
      { type: 'queue_update', steering: ['steer me'], followUp: ['then follow up'] },
    ])
    expect(schemaFailures(wire)).toEqual([])
  })

  it('clears both lists when the inbox empties', () => {
    expect(translateAll([inbox([])], { queuedText })).toEqual([
      { type: 'queue_update', steering: [], followUp: [] },
    ])
  })

  it('labels a message whose text is unknown instead of dropping it', () => {
    expect(translateAll([inbox([{ id: 99, mode: 'steer' }])], { queuedText })[0]).toMatchObject({
      steering: ['(queued message)'],
    })
  })

  it('does not show passive writes as pending messages', () => {
    expect(translateAll([inbox([{ id: 3, mode: 'write' }])], { queuedText })[0]).toMatchObject({
      steering: [],
      followUp: [],
    })
  })
})

describe('a snapshot that carries a live run', () => {
  /** The minimal snapshot shape the translator reads; the run is what a reopen hands back. */
  const snapshot = (withRun: boolean): AgentEvent => {
    const base: AgentEvent = {
      type: 'snapshot',
      entries: [],
      inbox: [],
      tools: [],
      nestedTools: [],
      compactions: [],
      agent: {},
      usage: { models: {}, tools: {} },
    }
    // The field is omitted rather than undefined so the shape matches an idle snapshot exactly.
    if (withRun) return { ...base, run: { inputs: [] } }
    return base
  }

  it('announces the run once, so a resumed run gets a Stop button', () => {
    const translate = createWireTranslator()
    expect(translate(snapshot(true)).map((e) => e.type)).toEqual(['agent_start'])
  })

  it('does not announce an idle snapshot', () => {
    const translate = createWireTranslator()
    expect(translate(snapshot(false))).toEqual([])
  })

  it('does not announce twice when a normal run then gets an overflow snapshot', () => {
    const translate = createWireTranslator()
    // The common case: the run announced itself with `run_start`, and only then does an overflow
    // snapshot arrive carrying the same run. `run_start` must set the flag, or this re-announces.
    expect(translate({ type: 'run_start', inputs: [submissionId(1)] }).map((e) => e.type)).toEqual([
      'agent_start',
    ])
    expect(translate(snapshot(true))).toEqual([])
  })

  it('does not announce twice when an overflow snapshot arrives mid-run', () => {
    const translate = createWireTranslator()
    translate(snapshot(true))
    // An overflow while the run is live re-sends the run. Re-announcing would clear the messages
    // collected so far and drop an abort the user pressed during the run.
    expect(translate(snapshot(true))).toEqual([])
    // After the run ends, the next fresh run is announced again.
    translate({ type: 'run_end', inputs: [] })
    expect(translate(snapshot(true)).map((e) => e.type)).toEqual(['agent_start'])
  })
})
