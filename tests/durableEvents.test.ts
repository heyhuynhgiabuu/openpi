import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FauxResponseStep } from '@earendil-works/pi-ai'
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDurableHarness } from '../electron/pi/durable/harness'
import type { DurableHarness } from '../electron/pi/durable/types'
import { sessionEventSchema } from '../src/lib/ipc'
import { applySessionEvent } from '../src/lib/sessionEvents'
import type { Message } from '../src/types/session'
import { schemaFailures } from './helpers/wireEvents'

/**
 * Phase 8.3d/8.3k, end to end: a real durable run, every event checked against the renderer's own
 * schema, and the result fed through the renderer's own reducer. Counting event *names* (what this
 * file used to do) cannot catch a shape mismatch, which is how `message_end`, `turn_end` and
 * `agent_end` shipped unusable.
 */

let workspace = ''
beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'openpi-events-'))
})
afterEach(async () => {
  await rm(workspace, { recursive: true, force: true })
})

const stop = { stopReason: 'stop' as const }

async function open(responses: FauxResponseStep[], tools = false, policy = false) {
  const faux = fauxProvider()
  faux.setResponses(responses)
  const harness = await openDurableHarness({
    backend: 'memory',
    model: { provider: faux.getModel().provider, modelId: faux.getModel().id },
    registerProviders: (models) => models.setProvider(faux.provider),
    tools,
    policy,
    workspacePath: workspace,
  })
  const events: Record<string, unknown>[] = []
  const detach = await harness.watchEvents((event) => events.push(event))
  return { harness, events, detach }
}

async function finish(h: { harness: DurableHarness; detach: () => Promise<void> }) {
  // Let the last batch of events land before closing.
  await new Promise((resolve) => setTimeout(resolve, 150))
  await h.detach()
  await h.harness.close()
}

function render(events: readonly Record<string, unknown>[]): Message[] {
  let messages: Message[] = []
  for (const event of events) {
    const parsed = sessionEventSchema.safeParse(event)
    if (parsed.success) messages = applySessionEvent(messages, parsed.data)
  }
  return messages
}

const typesOf = (events: readonly Record<string, unknown>[]) => events.map((e) => String(e.type))

describe('a plain answer', () => {
  it('passes the renderer schema and renders the answer once', async () => {
    const h = await open([fauxAssistantMessage([fauxText('the answer')], stop)])
    await h.harness.prompt('a question')
    await finish(h)

    expect(schemaFailures(h.events)).toEqual([])
    const types = typesOf(h.events)
    expect(types).toContain('agent_start')
    expect(types).toContain('agent_end')
    expect(types).not.toContain('run_start')
    expect(types).not.toContain('run_end')

    const messages = render(h.events)
    expect(messages[0]).toMatchObject({ role: 'user', text: 'a question' })
    expect(messages.filter((m) => m.role === 'assistant')).toMatchObject([{ text: 'the answer' }])
  })

  it('ends with exactly one agent_settled, not aborted', async () => {
    const h = await open([fauxAssistantMessage([fauxText('x')], stop)])
    await h.harness.prompt('q')
    await finish(h)
    const settled = h.events.filter((e) => e.type === 'agent_settled')
    expect(settled).toEqual([{ type: 'agent_settled', aborted: false }])
  })
})

describe('a tool call', () => {
  it('renders a finished tool card with the real output and gives turn_end its results', async () => {
    await writeFile(join(workspace, 'a.txt'), 'hello file')
    const h = await open(
      [
        fauxAssistantMessage(
          [fauxText('reading'), fauxToolCall('read', { path: join(workspace, 'a.txt') })],
          { stopReason: 'toolUse' as const }
        ),
        fauxAssistantMessage([fauxText('all done')], stop),
      ],
      true
    )
    await h.harness.prompt('read it')
    await finish(h)

    expect(schemaFailures(h.events)).toEqual([])
    const turnEnds = h.events.filter((e) => e.type === 'turn_end')
    expect(turnEnds).toHaveLength(2)
    expect(turnEnds[0]).toMatchObject({ toolResults: [{ role: 'toolResult', toolName: 'read' }] })
    expect(turnEnds[1]).toMatchObject({ toolResults: [] })

    const cards = render(h.events).flatMap((m) => ('toolCards' in m ? m.toolCards : []))
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({ toolName: 'read', isError: false, streaming: false })
    expect(cards[0]?.output).toContain('hello file')
  })

  it('actually writes a file the model asks for', async () => {
    // `read` was the only tool ever exercised here, so the write path — the one the pre-apply review
    // gate exists to guard, and which durable does not load — had no end-to-end proof at all.
    const target = join(workspace, 'written.txt')
    const h = await open(
      [
        fauxAssistantMessage(
          [fauxToolCall('write', { path: target, content: 'written by the model' })],
          { stopReason: 'toolUse' as const }
        ),
        fauxAssistantMessage([fauxText('done')], stop),
      ],
      true,
      // The production default. A write inside the workspace must pass the gate, which is also the
      // half of the gate's behaviour that a "blocks everything" bug would break.
      true
    )
    await h.harness.prompt('write it')
    await finish(h)

    expect(schemaFailures(h.events)).toEqual([])
    expect(await readFile(target, 'utf-8')).toBe('written by the model')
    const cards = render(h.events).flatMap((m) => ('toolCards' in m ? m.toolCards : []))
    expect(cards.find((card) => card.toolName === 'write')).toMatchObject({
      isError: false,
      streaming: false,
    })
  })

  it('blocks a high-risk shell command through the desktop policy gate', async () => {
    // The gate is the only thing standing in for the pre-apply review extension on this runtime, so
    // it needs proof that it actually stops a command rather than merely being registered.
    const victim = join(workspace, 'must-survive')
    await mkdir(victim, { recursive: true })
    const h = await open(
      [
        fauxAssistantMessage([fauxToolCall('bash', { command: `rm -rf ${victim}` })], {
          stopReason: 'toolUse' as const,
        }),
        fauxAssistantMessage([fauxText('blocked, I will not do that')], stop),
      ],
      true,
      true
    )
    await h.harness.prompt('delete it')
    await finish(h)

    expect(schemaFailures(h.events)).toEqual([])
    // The directory is still there: the command never ran.
    expect(await readdir(victim)).toEqual([])
    // The block is reported as a failed tool result, in the model's own transcript.
    const ends = h.events.filter((e) => e.type === 'tool_execution_end')
    expect(ends).toHaveLength(1)
    expect(ends[0]).toMatchObject({ toolName: 'bash', isError: true })
    expect(JSON.stringify(ends[0]?.result)).toContain('Blocked by desktop policy')
  })
})

describe('queued messages and abort', () => {
  function gate() {
    let release = () => {}
    let enter = () => {}
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    const entered = new Promise<void>((resolve) => {
      enter = resolve
    })
    const step: FauxResponseStep = async (_context, options) => {
      enter()
      await new Promise<void>((resolve, reject) => {
        void released.then(resolve)
        options?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
      return fauxAssistantMessage([fauxText('first')], stop)
    }
    return { step, release, entered }
  }

  it('settles once, after the queued run, and shows the pending text', async () => {
    const hold = gate()
    const h = await open([hold.step, fauxAssistantMessage([fauxText('second')], stop)])
    const first = h.harness.prompt('one')
    await hold.entered
    const queued = await h.harness.queue('then two', 'followUp')
    hold.release()
    await first
    await queued.settled
    await finish(h)

    expect(schemaFailures(h.events)).toEqual([])
    expect(typesOf(h.events).filter((t) => t === 'agent_end')).toHaveLength(2)
    expect(h.events.filter((e) => e.type === 'agent_settled')).toHaveLength(1)
    const pending = h.events.find((e) => e.type === 'queue_update')
    expect(pending).toMatchObject({ followUp: ['then two'] })
  }, 30_000)

  it('reports an aborted run as aborted', async () => {
    const hold = gate()
    const h = await open([hold.step])
    const running = h.harness.prompt('long task')
    await hold.entered
    await h.harness.abort()
    await running
    await finish(h)

    expect(schemaFailures(h.events)).toEqual([])
    expect(h.events.find((e) => e.type === 'agent_settled')).toMatchObject({ aborted: true })
  }, 30_000)
})

describe('attaching and detaching', () => {
  it('stops delivering after stop() and tolerates a second stop', async () => {
    const h = await open([
      fauxAssistantMessage([fauxText('a')], stop),
      fauxAssistantMessage([fauxText('b')], stop),
    ])
    await h.detach()
    const afterStop = h.events.length
    await h.detach()
    await h.harness.prompt('later')
    expect(h.events.length).toBe(afterStop)
    await h.harness.close()
  })
})
