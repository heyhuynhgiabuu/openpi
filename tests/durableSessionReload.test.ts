import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import type { ResolvedModel } from '../electron/pi/durableSettings'
import type { SidecarMessage } from '../electron/pi/sidecarTypes'
import { prompt, setup, useSessionRoot, waitFor } from './helpers/durableSession'

/**
 * Phase 8.3o: `reload_session` on a durable session: a full restart over the same store, so the
 * conversation, name, model and file are the same and only the harness is fresh.
 */

useSessionRoot()

const OTHER: ResolvedModel = {
  info: { id: 'other', name: 'Other', provider: 'faux', reasoning: true, contextWindow: 2000 },
  thinkingLevels: ['off'],
}

type Ready = Extract<SidecarMessage, { type: 'session_ready' }>
const readies = (sent: SidecarMessage[]) =>
  sent.filter((m): m is Ready => m.type === 'session_ready')

async function messageCount(t: Awaited<ReturnType<typeof setup>>): Promise<number> {
  await t.sessions.handleCommand({ type: 'get_session_info', requestId: `i${t.sent.length}` })
  const info = t.sent.filter((m) => m.type === 'session_info_result').at(-1)
  return info && 'info' in info ? info.info.messageCount : -1
}

describe('durable reload_session', () => {
  it('keeps the conversation, file and name, and answers with the same requestId', async () => {
    const t = await setup({ persistent: true, answers: ['one', 'two'] })
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      await t.sessions.handleCommand(prompt('first'))
      await t.sessions.handleCommand({ type: 'set_session_name', name: 'My work' })
      expect(await messageCount(t)).toBe(2)

      await t.sessions.handleCommand({ type: 'reload_session', requestId: 'r1' })

      const [first, second] = readies(t.sent)
      expect(second).toMatchObject({ requestId: 'r1' })
      expect(second?.payload).toMatchObject({
        sessionId: first?.payload.sessionId,
        sessionFile: first?.payload.sessionFile,
        sessionName: 'My work',
      })
      expect(t.harnesses).toHaveLength(2)
      expect(await messageCount(t)).toBe(2)

      // The reloaded harness keeps working, on the same conversation.
      await t.sessions.handleCommand(prompt('second'))
      expect(await messageCount(t)).toBe(4)
      const file = await readFile(t.identity.sessionFile, 'utf8')
      expect(file.match(/"first"/g)).toHaveLength(1)
      expect(file).toContain('"second"')
    } finally {
      await t.sessions.stop()
    }
  })

  it('keeps the header time of the original session', async () => {
    let tick = 0
    const t = await setup({
      persistent: true,
      now: () => new Date(Date.UTC(2026, 9, 27, 0, 0, tick++)),
    })
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      await t.sessions.handleCommand(prompt('hi'))
      await t.sessions.handleCommand({ type: 'reload_session', requestId: 'r' })
      await t.sessions.handleCommand(prompt('again'))
      const header = JSON.parse(
        (await readFile(t.identity.sessionFile, 'utf8')).split('\n')[0] ?? ''
      )
      expect(header.timestamp).toBe('2026-10-27T00:00:00.000Z')
    } finally {
      await t.sessions.stop()
    }
  })

  it("reports the model the session was using, not today's default", async () => {
    const t = await setup({ persistent: true, knownModels: { 'faux/other': OTHER } })
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      await t.sessions.handleCommand({ type: 'set_model', provider: 'faux', modelId: 'other' })
      await t.sessions.handleCommand({ type: 'reload_session', requestId: 'r' })
      expect(readies(t.sent).at(-1)?.payload.model).toMatchObject({ id: 'other' })
    } finally {
      await t.sessions.stop()
    }
  })

  it('streams events from the reloaded harness', async () => {
    const t = await setup({ persistent: true })
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      await t.sessions.handleCommand({ type: 'reload_session', requestId: 'r' })
      const before = t.sent.length
      await t.sessions.handleCommand(prompt('hello'))
      await waitFor(
        () =>
          t.sent
            .slice(before)
            .some((m) => m.type === 'session_event' && m.event.type === 'agent_end'),
        'agent_end from the reloaded harness'
      )
    } finally {
      await t.sessions.stop()
    }
  })

  it('reports the failure to the requester and leaves no half-open session', async () => {
    const t = await setup({ persistent: true, failOpenAt: 2 })
    await t.sessions.start('/work', { workspaceTrusted: false })
    await expect(
      t.sessions.handleCommand({ type: 'reload_session', requestId: 'r' })
    ).rejects.toThrow('no default model')
    expect(t.sessions.isActive()).toBe(false)
  })
})
