import { readFile } from 'node:fs/promises'
import { fauxAssistantMessage, fauxText, type FauxResponseStep } from '@earendil-works/pi-ai'
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

  it('closes the harness it opened when setting up the reloaded session fails', async () => {
    const t = await setup({ persistent: true, breakStatsAt: 2 })
    await t.sessions.start('/work', { workspaceTrusted: false })
    await expect(
      t.sessions.handleCommand({ type: 'reload_session', requestId: 'r' })
    ).rejects.toThrow('stats unavailable')
    // The first harness closed for the reload, the second because its setup failed.
    expect(t.harnesses).toHaveLength(2)
    expect(t.closed).toEqual(t.harnesses)
    expect(t.sessions.isActive()).toBe(false)
  })

  it('aborts a reply in progress instead of leaving it to resume on the next prompt', async () => {
    let release = () => {}
    let enter = () => {}
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    const entered = new Promise<void>((resolve) => {
      enter = resolve
    })
    const requests: string[] = []
    const held: FauxResponseStep = async (context, options) => {
      requests.push(JSON.stringify(context.messages))
      enter()
      await new Promise<void>((resolve, reject) => {
        void released.then(resolve)
        options?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
      return fauxAssistantMessage([fauxText('never shown')], { stopReason: 'stop' as const })
    }
    const next: FauxResponseStep = async (context) => {
      requests.push(JSON.stringify(context.messages))
      return fauxAssistantMessage([fauxText('after reload')], { stopReason: 'stop' as const })
    }
    const t = await setup({ persistent: true, responses: [held, next] })
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      const running = t.sessions.handleCommand(prompt('start the task'))
      await entered
      await t.sessions.handleCommand({ type: 'reload_session', requestId: 'r' })
      // The cut-short prompt ends quietly: no thrown error, no error message, no logged failure.
      await expect(running).resolves.toBe(true)
      expect(t.sent.filter((m) => m.type === 'error')).toEqual([])
      expect(t.logs.filter((l) => l.startsWith('error'))).toEqual([])

      await t.sessions.handleCommand(prompt('next'))
      release()
      // One call for the held run, one for the new prompt: the aborted run did not start again.
      expect(requests).toHaveLength(2)
      expect(requests[1]).not.toContain('"assistant"')
      expect(requests[1]).toContain('next')
    } finally {
      release()
      await t.sessions.stop()
    }
  })

  it('does not share a store between sessions', async () => {
    const t = await setup({ persistent: true, answers: ['one'] })
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      await t.sessions.handleCommand(prompt('first'))
      await t.sessions.start('/work', { workspaceTrusted: false })
      expect(readies(t.sent).at(-1)?.payload.sessionId).not.toBe(
        readies(t.sent)[0]?.payload.sessionId
      )
      expect(await messageCount(t)).toBe(0)
    } finally {
      await t.sessions.stop()
    }
  })

  it('says so when the stored model can no longer be found', async () => {
    const t = await setup({ persistent: true, knownModels: { 'faux/other': OTHER } })
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      await t.sessions.handleCommand({ type: 'set_model', provider: 'faux', modelId: 'other' })
      delete t.knownModels['faux/other']
      await t.sessions.handleCommand({ type: 'reload_session', requestId: 'r' })
      expect(t.logs.join('\n')).toContain('stored model faux/other is not available')
      expect(readies(t.sent).at(-1)?.payload.model).toMatchObject({ id: 'm' })
    } finally {
      await t.sessions.stop()
    }
  })

  it('still reloads when looking up the stored model throws', async () => {
    const t = await setup({ persistent: true, knownModels: { 'faux/other': OTHER } })
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      await t.sessions.handleCommand({ type: 'set_model', provider: 'faux', modelId: 'other' })
      t.resolver.fail = true
      await t.sessions.handleCommand({ type: 'reload_session', requestId: 'r' })
      expect(t.logs.join('\n')).toContain('looking up the stored model failed: registry offline')
      expect(t.sessions.isActive()).toBe(true)
      expect(readies(t.sent).at(-1)?.payload.model).toMatchObject({ id: 'm' })
    } finally {
      await t.sessions.stop()
    }
  })

  it('reloads without any warning when the stored model is still known', async () => {
    const t = await setup({ persistent: true })
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      await t.sessions.handleCommand({ type: 'reload_session', requestId: 'r' })
      expect(t.logs.filter((l) => l.startsWith('warn'))).toEqual([])
    } finally {
      await t.sessions.stop()
    }
  })
})
