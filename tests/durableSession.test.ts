import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FauxResponseStep } from '@earendil-works/pi-ai'
import { fauxAssistantMessage, fauxProvider, fauxText } from '@earendil-works/pi-ai'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDurableHarness } from '../electron/pi/durable/harness'
import { importSessionFile } from '../electron/pi/durable/importer'
import type { DurableHarness } from '../electron/pi/durable/types'
import { createDurableSessions, type DurableSessionDeps } from '../electron/pi/durableSession'
import type { SidecarCommand, SidecarMessage } from '../electron/pi/sidecarTypes'

/**
 * Phase 8.3f: the durable session behind the sidecar protocol. Real harness, faux provider, real
 * export + importer; only the sidecar's parent port is replaced by a recording `send`.
 */

let root = ''
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'openpi-durable-session-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const MODEL = { id: 'm', name: 'M', provider: 'faux', reasoning: false, contextWindow: 1000 }

async function setup(
  options: {
    answers?: string[]
    responses?: FauxResponseStep[]
    sessionFile?: string
    failOpen?: boolean
  } = {}
) {
  const sent: SidecarMessage[] = []
  const logs: string[] = []
  const harnesses: DurableHarness[] = []
  const faux = fauxProvider()
  faux.setResponses(
    options.responses ??
      (options.answers ?? ['an answer']).map((text) =>
        fauxAssistantMessage([fauxText(text)], { stopReason: 'stop' as const })
      )
  )
  const identity = {
    sessionId: 'sess-1',
    sessionFile: options.sessionFile ?? join(root, 'sessions', 'sess-1.jsonl'),
  }
  const deps: DurableSessionDeps = {
    send: (message) => sent.push(message),
    log: (level, text) => logs.push(`${level}: ${text}`),
    newIdentity: () => identity,
    now: () => new Date('2026-10-27T00:00:00.000Z'),
    open: async () => {
      if (options.failOpen) throw new Error('no default model')
      const harness = await openDurableHarness({
        backend: 'memory',
        model: { provider: faux.getModel().provider, modelId: faux.getModel().id },
        registerProviders: (models) => models.setProvider(faux.provider),
        tools: false,
        policy: false,
      })
      harnesses.push(harness)
      return { harness, model: MODEL }
    },
  }
  const sessions = createDurableSessions(deps)
  const types = () => sent.map((m) => m.type)
  return { sessions, sent, logs, identity, types, harnesses }
}

const prompt = (text: string, contextPrefix?: string): SidecarCommand => ({
  type: 'prompt',
  text,
  contextPrefix,
})

describe('durable session start', () => {
  it('sends session_ready first, then the event feed, with the session identity', async () => {
    const t = await setup()
    await t.sessions.start('/work', { workspaceTrusted: true, requestId: 'req-1' })
    try {
      const ready = t.sent[0]
      expect(ready).toMatchObject({
        type: 'session_ready',
        requestId: 'req-1',
        payload: {
          cwd: '/work',
          sessionId: 'sess-1',
          sessionFile: t.identity.sessionFile,
          model: MODEL,
        },
      })
      // The renderer resets conversation state on ready, so the snapshot must come after it.
      expect(t.sent[1]).toMatchObject({ type: 'session_event', event: { type: 'snapshot' } })
      expect(t.sessions.isActive()).toBe(true)
    } finally {
      await t.sessions.stop()
    }
  })

  it('does not stay active when the harness cannot open', async () => {
    const t = await setup({ failOpen: true })
    await expect(t.sessions.start('/work', { workspaceTrusted: false })).rejects.toThrow(
      /no default model/
    )
    expect(t.sessions.isActive()).toBe(false)
    expect(t.types()).not.toContain('session_ready')
  })

  it('replaces a previous durable session instead of leaking it', async () => {
    const t = await setup()
    await t.sessions.start('/work', { workspaceTrusted: false })
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      expect(t.harnesses).toHaveLength(2)
      expect(t.types().filter((type) => type === 'session_ready')).toHaveLength(2)
    } finally {
      await t.sessions.stop()
    }
  })
})

describe('durable session prompt', () => {
  it('runs the prompt, streams the renderer vocabulary, and exports a readable session file', async () => {
    const t = await setup({ answers: ['the durable answer'] })
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      expect(await t.sessions.handleCommand(prompt('hello there'))).toBe(true)

      const eventTypes = t.sent
        .filter((m) => m.type === 'session_event')
        .map((m) => (m.type === 'session_event' ? String(m.event.type) : ''))
      expect(eventTypes).toContain('agent_start')
      expect(eventTypes).toContain('agent_end')
      expect(t.types()).toContain('session_index_updated')

      const imported = await importSessionFile(t.identity.sessionFile)
      expect(imported.invalid).toBe(false)
      const text = JSON.stringify(imported.messages)
      expect(text).toContain('hello there')
      expect(text).toContain('the durable answer')
      const header = (await readFile(t.identity.sessionFile, 'utf8')).split('\n', 1)[0] ?? ''
      expect(JSON.parse(header)).toMatchObject({ id: 'sess-1', cwd: '/work', version: 3 })
    } finally {
      await t.sessions.stop()
    }
  })

  it('prefixes the context the way the SDK path does', async () => {
    const t = await setup()
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      await t.sessions.handleCommand(prompt('  the question  ', ' background '))
      const imported = await importSessionFile(t.identity.sessionFile)
      expect(JSON.stringify(imported.messages)).toContain('background\\n\\nthe question')
    } finally {
      await t.sessions.stop()
    }
  })

  it('refuses slash commands instead of sending them to the model', async () => {
    const t = await setup()
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      await expect(t.sessions.handleCommand(prompt('/compact'))).rejects.toThrow(/slash commands/)
    } finally {
      await t.sessions.stop()
    }
  })

  it('keeps the run result when the export fails, and says so', async () => {
    const sessionFile = join(root, 'foreign.jsonl')
    await writeFile(
      sessionFile,
      '{"type":"session","version":3,"id":"someone-else","timestamp":"2026-01-01T00:00:00.000Z","cwd":"/x"}\n',
      'utf8'
    )
    const t = await setup({ sessionFile })
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      await expect(t.sessions.handleCommand(prompt('hi'))).resolves.toBe(true)
      expect(t.logs.join('\n')).toContain('session export failed')
      expect(t.types()).not.toContain('session_index_updated')
    } finally {
      await t.sessions.stop()
    }
  })
})

describe('durable command routing', () => {
  const unsupported: SidecarCommand[] = [
    { type: 'execute_bash', requestId: 'r', command: 'ls' },
    { type: 'set_model', provider: 'p', modelId: 'm' },
    { type: 'set_thinking', level: 'low' },
    { type: 'set_session_name', name: 'n' },
    { type: 'get_session_info', requestId: 'r' },
    { type: 'compact', requestId: 'r' },
    { type: 'reload_session', requestId: 'r' },
    { type: 'copy_last_assistant_text', requestId: 'r' },
    { type: 'fork_session', entryId: 'e', workspaceTrusted: false },
    { type: 'navigate_tree', entryId: 'e', requestId: 'r' },
    { type: 'get_stats', requestId: 'r' },
  ]

  it.each(unsupported)('refuses $type loudly while a durable session is active', async (cmd) => {
    const t = await setup()
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      await expect(t.sessions.handleCommand(cmd)).rejects.toThrow(
        /not supported on the durable runtime/
      )
    } finally {
      await t.sessions.stop()
    }
  })

  it('hands non-session commands back to the existing handlers', async () => {
    const t = await setup()
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      expect(await t.sessions.handleCommand({ type: 'get_models', requestId: 'r' })).toBe(false)
      expect(await t.sessions.handleCommand({ type: 'get_settings', requestId: 'r' })).toBe(false)
      expect(await t.sessions.handleCommand({ type: 'start_session', cwd: '/work' })).toBe(false)
    } finally {
      await t.sessions.stop()
    }
  })

  it('does nothing at all when no durable session is active', async () => {
    const t = await setup()
    for (const cmd of [prompt('hi'), { type: 'abort' } as const, { type: 'stop' } as const]) {
      expect(await t.sessions.handleCommand(cmd)).toBe(false)
    }
    expect(t.sent).toEqual([])
  })

  it('stops the durable session on stop and lets the SDK handler finish the shutdown', async () => {
    const t = await setup()
    await t.sessions.start('/work', { workspaceTrusted: false })
    expect(await t.sessions.handleCommand({ type: 'stop' })).toBe(false)
    expect(t.sessions.isActive()).toBe(false)
  })
})

describe('durable abort', () => {
  /** A model call that stays open until the run's abort signal fires. */
  function heldUntilAborted(entered: { resolve: () => void }): FauxResponseStep {
    return (_context, options) =>
      new Promise((_resolve, reject) => {
        entered.resolve()
        options?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
  }

  it('cancels a run in flight and leaves the session usable', async () => {
    let enter = () => {}
    const entered = new Promise<void>((resolve) => {
      enter = resolve
    })
    const t = await setup({
      responses: [
        heldUntilAborted({ resolve: enter }),
        fauxAssistantMessage([fauxText('after the abort')], { stopReason: 'stop' as const }),
      ],
    })
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      const running = t.sessions.handleCommand(prompt('a long task'))
      await entered

      expect(await t.sessions.handleCommand({ type: 'abort' })).toBe(true)
      await expect(running).resolves.toBe(true)

      const eventTypes = t.sent.flatMap((m) =>
        m.type === 'session_event' ? [String(m.event.type)] : []
      )
      expect(eventTypes).toContain('agent_end')
      // The user cancelled it: that is not a failure worth a warning.
      expect(t.logs.join('\n')).not.toContain('without an answer')
      expect(t.types()).toContain('session_index_updated')

      // Read the export *before* the next prompt: the cancelled run's input must already be there.
      const cancelled = await importSessionFile(t.identity.sessionFile)
      expect(cancelled.invalid).toBe(false)
      expect(JSON.stringify(cancelled.messages)).toContain('a long task')

      await t.sessions.handleCommand(prompt('and again'))
      const imported = await importSessionFile(t.identity.sessionFile)
      expect(JSON.stringify(imported.messages)).toContain('after the abort')
      // Nothing from the cancelled run was lost by the later export.
      expect(JSON.stringify(imported.messages)).toContain('a long task')
    } finally {
      await t.sessions.stop()
    }
  }, 30_000)

  it('is harmless when nothing is running, and repeatable', async () => {
    const t = await setup()
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      expect(await t.sessions.handleCommand({ type: 'abort' })).toBe(true)
      expect(await t.sessions.handleCommand({ type: 'abort' })).toBe(true)
      expect(t.logs).toEqual([])
    } finally {
      await t.sessions.stop()
    }
  }, 30_000)
})

async function waitFor(condition: () => boolean | Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (await condition()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`timed out waiting for ${what}`)
}

describe('durable steer and follow-up', () => {
  /** A model call that stays open until `release()`, or until the run is aborted. */
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
      return fauxAssistantMessage([fauxText('first answer')], { stopReason: 'stop' as const })
    }
    return { step, release, entered }
  }

  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

  function queueTexts(sent: SidecarMessage[]) {
    return sent.flatMap((m) =>
      m.type === 'session_event' && m.event.type === 'queue_update'
        ? [{ steering: strings(m.event.steering), followUp: strings(m.event.followUp) }]
        : []
    )
  }

  async function exported(t: { identity: { sessionFile: string } }): Promise<string> {
    return JSON.stringify((await importSessionFile(t.identity.sessionFile)).messages)
  }

  it.each([
    ['steer', 'steering', { type: 'steer' as const, text: 'change course' }],
    ['follow_up', 'followUp', { type: 'follow_up' as const, text: 'change course' }],
  ])(
    '%s is admitted mid-run, shown as pending, then delivered to the model',
    async (_name, field, cmd) => {
      const hold = gate()
      const seen: string[] = []
      const t = await setup({
        responses: [
          hold.step,
          (context) => {
            seen.push(JSON.stringify(context))
            return fauxAssistantMessage([fauxText('second answer')], {
              stopReason: 'stop' as const,
            })
          },
        ],
      })
      await t.sessions.start('/work', { workspaceTrusted: false })
      try {
        const running = t.sessions.handleCommand(prompt('start the task'))
        await hold.entered

        // Admitted, not answered: the command returns while the first run is still open.
        expect(await t.sessions.handleCommand(cmd)).toBe(true)
        await waitFor(
          () =>
            queueTexts(t.sent).some((q) =>
              q[field as 'steering' | 'followUp'].includes('change course')
            ),
          'the pending message to reach the renderer'
        )

        hold.release()
        await running
        await waitFor(
          async () => (await exported(t)).includes('second answer'),
          'the queued run export'
        )

        expect(seen.join('')).toContain('change course')
        const text = await exported(t)
        expect(text).toContain('start the task')
        expect(text).toContain('change course')
        // The pending chip is cleared once the message was delivered.
        const last = queueTexts(t.sent).at(-1)
        expect(last).toEqual({ steering: [], followUp: [] })
      } finally {
        await t.sessions.stop()
      }
    },
    30_000
  )

  it('starts a run when nothing is running, and still exports it', async () => {
    const t = await setup({ answers: ['idle answer'] })
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      expect(await t.sessions.handleCommand({ type: 'steer', text: 'hello idle' })).toBe(true)
      await waitFor(async () => (await exported(t)).includes('idle answer'), 'the export')
      expect(await exported(t)).toContain('hello idle')
    } finally {
      await t.sessions.stop()
    }
  }, 30_000)

  it('refuses slash commands and applies the context prefix like prompt does', async () => {
    const t = await setup({ answers: ['ok'] })
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      await expect(t.sessions.handleCommand({ type: 'steer', text: '/compact' })).rejects.toThrow(
        /slash commands/
      )
      await expect(t.sessions.handleCommand({ type: 'follow_up', text: '/x' })).rejects.toThrow(
        /slash commands/
      )
      await t.sessions.handleCommand({ type: 'steer', text: 'body', contextPrefix: 'ctx' })
      await waitFor(async () => (await exported(t)).includes('ok'), 'the export')
      expect(await exported(t)).toContain('ctx\\n\\nbody')
    } finally {
      await t.sessions.stop()
    }
  }, 30_000)

  it('stays quiet when the session is stopped while a queued message is pending', async () => {
    const hold = gate()
    const t = await setup({ responses: [hold.step] })
    await t.sessions.start('/work', { workspaceTrusted: false })
    void t.sessions.handleCommand(prompt('long')).catch(() => undefined)
    await hold.entered
    await t.sessions.handleCommand({ type: 'follow_up', text: 'later' })
    await t.sessions.stop()
    // Let the held model call finish *after* shutdown: the queued message settles late.
    hold.release()
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(t.logs).toEqual([])
  }, 30_000)
})
