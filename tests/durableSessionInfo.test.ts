import { describe, expect, it } from 'vitest'
import type { FauxResponseStep } from '@earendil-works/pi-ai'
import { fauxAssistantMessage, fauxText } from '@earendil-works/pi-ai'
import type { SidecarMessage } from '../electron/pi/sidecarTypes'
import { prompt, setup, useSessionRoot, waitFor } from './helpers/durableSession'

/**
 * Phase 8.3i: get_stats, get_session_info and copy_last_assistant_text on a durable session, read
 * from pi-durable's own ledger and transcript.
 */

useSessionRoot()

function reply<T extends SidecarMessage['type']>(sent: SidecarMessage[], type: T) {
  return sent.filter((m): m is Extract<SidecarMessage, { type: T }> => m.type === type).at(-1)
}

describe('durable session info', () => {
  it('reports an empty session before any run', async () => {
    const t = await setup()
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      await t.sessions.handleCommand({ type: 'get_stats', requestId: 's1' })
      await t.sessions.handleCommand({ type: 'get_session_info', requestId: 'i1' })
      await t.sessions.handleCommand({ type: 'copy_last_assistant_text', requestId: 'c1' })

      expect(reply(t.sent, 'stats_result')?.stats).toMatchObject({
        inputTokens: 0,
        outputTokens: 0,
        cost: 0,
        contextTokens: null,
        isStreaming: false,
        sessionId: 'sess-1',
      })
      expect(reply(t.sent, 'session_info_result')?.info).toMatchObject({
        messageCount: 0,
        contextTokens: null,
      })
      expect(reply(t.sent, 'last_assistant_text_result')?.text).toBeNull()
    } finally {
      await t.sessions.stop()
    }
  })

  it('reports real usage, message count, context fill and the last answer after a run', async () => {
    const t = await setup({ answers: ['the durable answer'] })
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      await t.sessions.handleCommand(prompt('a question for the model'))
      await t.sessions.handleCommand({ type: 'get_stats', requestId: 's2' })
      await t.sessions.handleCommand({ type: 'get_session_info', requestId: 'i2' })
      await t.sessions.handleCommand({ type: 'copy_last_assistant_text', requestId: 'c2' })

      const stats = reply(t.sent, 'stats_result')?.stats
      expect(Number(stats?.inputTokens)).toBeGreaterThan(0)
      expect(Number(stats?.outputTokens)).toBeGreaterThan(0)
      expect(Number(stats?.contextTokens)).toBeGreaterThan(0)
      expect(Number(stats?.contextUsagePercent)).toBeGreaterThan(0)

      const info = reply(t.sent, 'session_info_result')?.info
      expect(info?.messageCount).toBe(2)
      expect(info?.model).toMatchObject({ id: 'm', contextWindow: 1000 })
      expect(info?.sessionFile).toBe(t.identity.sessionFile)

      expect(reply(t.sent, 'last_assistant_text_result')).toMatchObject({
        requestId: 'c2',
        text: 'the durable answer',
      })
    } finally {
      await t.sessions.stop()
    }
  }, 30_000)

  it('says it is streaming while a run is open, and not afterwards', async () => {
    let release = () => {}
    let enter = () => {}
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    const entered = new Promise<void>((resolve) => {
      enter = resolve
    })
    const held: FauxResponseStep = async () => {
      enter()
      await released
      return fauxAssistantMessage([fauxText('done')], { stopReason: 'stop' as const })
    }
    const t = await setup({ responses: [held] })
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      const running = t.sessions.handleCommand(prompt('long task'))
      await entered
      await waitFor(
        () => t.sent.some((m) => m.type === 'session_event' && m.event.type === 'agent_start'),
        'agent_start'
      )

      await t.sessions.handleCommand({ type: 'get_stats', requestId: 'during' })
      expect(reply(t.sent, 'stats_result')?.stats.isStreaming).toBe(true)

      release()
      await running
      await t.sessions.handleCommand({ type: 'get_stats', requestId: 'after' })
      expect(reply(t.sent, 'stats_result')?.stats.isStreaming).toBe(false)
    } finally {
      await t.sessions.stop()
    }
  }, 30_000)
})
