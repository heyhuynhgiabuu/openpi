import { describe, expect, it } from 'vitest'
import type { FauxResponseStep } from '@earendil-works/pi-ai'
import { fauxAssistantMessage, fauxText } from '@earendil-works/pi-ai'
import { importSessionFile } from '../electron/pi/durable/importer'
import type { SidecarMessage } from '../electron/pi/sidecarTypes'
import { prompt, setup, useSessionRoot, waitFor } from './helpers/durableSession'

/**
 * Phase 8.3h: steer and follow-up on a durable session.
 */

useSessionRoot()

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

  const CASES = [
    { name: 'steer', field: 'steering', cmd: { type: 'steer', text: 'change course' } },
    { name: 'follow_up', field: 'followUp', cmd: { type: 'follow_up', text: 'change course' } },
  ] as const

  it.each(CASES)(
    '$name is admitted mid-run, shown as pending, then delivered to the model',
    async ({ field, cmd }) => {
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
          () => queueTexts(t.sent).some((q) => q[field].includes('change course')),
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

  it('applies the context prefix like prompt does, for slash prompts too', async () => {
    const t = await setup({ answers: ['ok'] })
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      // A slash prompt is admitted, not refused: the harness expands what it recognises.
      await t.sessions.handleCommand({ type: 'steer', text: '/review' })
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
    // The held run is aborted by `stop()` now, so it settles as answered-by-abort rather than
    // hanging; the shutdown itself must still be quiet — no error, nothing about the queue.
    expect(t.logs.filter((line) => line.startsWith('error'))).toEqual([])
  }, 30_000)
})
