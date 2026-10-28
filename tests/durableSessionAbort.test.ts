import { describe, expect, it } from 'vitest'
import type { FauxResponseStep } from '@earendil-works/pi-ai'
import { fauxAssistantMessage, fauxText } from '@earendil-works/pi-ai'
import { importSessionFile } from '../electron/pi/durable/importer'
import { prompt, setup, useSessionRoot } from './helpers/durableSession'

/**
 * Phase 8.3g: abort on a durable session.
 */

useSessionRoot()

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
