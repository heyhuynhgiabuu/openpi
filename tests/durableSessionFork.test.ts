import { existsSync } from 'node:fs'
import { type FauxResponseStep } from '@earendil-works/pi-ai'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'
import { prompt, setup, useSessionRoot } from './helpers/durableSession'
import {
  answer,
  fork,
  idOf,
  lines,
  mentions,
  readable,
  readies,
  textOf,
} from './helpers/forkSession'

/**
 * Phase 8.3o: `fork_session` on a durable session: a new session, with its own id and file, whose
 * history is the parent's up to and including the chosen entry; the parent is left as it was.
 */

useSessionRoot()

async function twoTurns(third?: string) {
  const requests: string[] = []
  const recording =
    (text: string): FauxResponseStep =>
    async (context) => {
      requests.push(readable(context.messages))
      return answer(text)
    }
  const t = await setup({
    persistent: true,
    responses: [recording('a1'), recording('a2'), recording(third ?? 'unused')],
  })
  await t.sessions.start('/work', { workspaceTrusted: false })
  await t.sessions.handleCommand(prompt('q1'))
  await t.sessions.handleCommand(prompt('q2'))
  return { t, requests }
}

describe('durable fork_session', () => {
  it('starts a new session with the history up to the entry, and leaves the parent alone', async () => {
    const { t } = await twoTurns()
    try {
      const parent = await lines(t.identity.sessionFile)
      await t.sessions.handleCommand(fork(idOf(parent, 'a1')))

      const [first, second] = readies(t.sent)
      expect(second).toMatchObject({ requestId: 'f1' })
      expect(second?.payload.sessionId).not.toBe(first?.payload.sessionId)
      expect(second?.payload.sessionFile).not.toBe(first?.payload.sessionFile)

      const child = await lines(second?.payload.sessionFile ?? '')
      expect(mentions(child, 'q1') && mentions(child, 'a1')).toBe(true)
      expect(mentions(child, 'q2') || mentions(child, 'a2')).toBe(false)
      // The parent file is exactly what it was.
      expect(await lines(t.identity.sessionFile)).toEqual(parent)
    } finally {
      await t.sessions.stop()
    }
  })

  it('writes the fork file before it announces the session', async () => {
    const seen: boolean[] = []
    const t = await setup({
      persistent: true,
      responses: [answer('a1')],
      onSend: (m) => {
        if (m.type === 'session_ready' && m.payload.sessionId !== 'sess-1') {
          seen.push(existsSync(m.payload.sessionFile ?? ''))
        }
      },
    })
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      await t.sessions.handleCommand(prompt('q1'))
      await t.sessions.handleCommand(fork(idOf(await lines(t.identity.sessionFile), 'a1')))
      expect(seen).toEqual([true])
    } finally {
      await t.sessions.stop()
    }
  })

  it('continues from the fork point: the model never sees the dropped turns', async () => {
    const { t, requests } = await twoTurns('a3')
    try {
      await t.sessions.handleCommand(fork(idOf(await lines(t.identity.sessionFile), 'a1')))
      await t.sessions.handleCommand(prompt('q3'))
      expect(requests).toHaveLength(3)
      expect(requests[2]).toContain('q1')
      expect(requests[2]).toContain('q3')
      expect(requests[2]).not.toContain('q2')

      const file = readies(t.sent).at(-1)?.payload.sessionFile ?? ''
      const child = await lines(file)
      expect(mentions(child, 'a3')).toBe(true)
      // The parent never learns of the fork's turn.
      expect(mentions(await lines(t.identity.sessionFile), 'q3')).toBe(false)
    } finally {
      await t.sessions.stop()
    }
  })

  it('is read back by the real SDK as the forked context', async () => {
    const { t } = await twoTurns()
    try {
      await t.sessions.handleCommand(fork(idOf(await lines(t.identity.sessionFile), 'a1')))
      const file = readies(t.sent).at(-1)?.payload.sessionFile ?? ''
      const context = readable(
        SessionManager.open(file, undefined, '/work').buildSessionContext().messages
      )
      expect(context).toContain('q1')
      expect(context).toContain('a1')
      expect(context).not.toContain('q2')
    } finally {
      await t.sessions.stop()
    }
  })

  it('accepts the synthetic id the renderer holds while a message streams', async () => {
    const { t } = await twoTurns()
    try {
      const parent = await lines(t.identity.sessionFile)
      const q1 = parent.find((line) => line.type === 'message' && textOf(line).includes('q1'))
      await t.sessions.handleCommand(fork(`u-${q1?.message?.timestamp}`))
      const child = await lines(readies(t.sent).at(-1)?.payload.sessionFile ?? '')
      expect(mentions(child, 'q1')).toBe(true)
      expect(mentions(child, 'a1')).toBe(false)
    } finally {
      await t.sessions.stop()
    }
  })

  it('fails on an unknown entry and leaves the running session untouched', async () => {
    const { t } = await twoTurns('a3')
    try {
      const before = t.harnesses.length
      await expect(t.sessions.handleCommand(fork('deadbeef'))).rejects.toThrow(
        'Cannot fork: entry not found (deadbeef)'
      )
      expect(t.sessions.isActive()).toBe(true)
      expect(t.harnesses).toHaveLength(before)
      expect(readies(t.sent)).toHaveLength(1)
      await t.sessions.handleCommand(prompt('still here'))
      expect(mentions(await lines(t.identity.sessionFile), 'still here')).toBe(true)
    } finally {
      await t.sessions.stop()
    }
  })

  it('a forked session reloads as itself, and can be forked again', async () => {
    const { t } = await twoTurns()
    try {
      await t.sessions.handleCommand(fork(idOf(await lines(t.identity.sessionFile), 'a1')))
      const forked = readies(t.sent).at(-1)
      await t.sessions.handleCommand({ type: 'reload_session', requestId: 'r' })
      const reloaded = readies(t.sent).at(-1)
      expect(reloaded?.payload.sessionId).toBe(forked?.payload.sessionId)
      const child = await lines(forked?.payload.sessionFile ?? '')
      expect(mentions(child, 'a1') && !mentions(child, 'q2')).toBe(true)

      // Ids are positional in the fork's own file; fork its first message again.
      await t.sessions.handleCommand(fork(idOf(child, 'q1'), 'f2'))
      const grandchild = await lines(readies(t.sent).at(-1)?.payload.sessionFile ?? '')
      expect(mentions(grandchild, 'q1')).toBe(true)
      expect(mentions(grandchild, 'a1')).toBe(false)
    } finally {
      await t.sessions.stop()
    }
  })

  it('aborts a reply in progress rather than leaving it to resume in the parent', async () => {
    let release = () => {}
    let enter = () => {}
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    const entered = new Promise<void>((resolve) => {
      enter = resolve
    })
    const requests: string[] = []
    const held: FauxResponseStep = async (_context, options) => {
      enter()
      await new Promise<void>((resolve, reject) => {
        void released.then(resolve)
        options?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
      return answer('never shown')
    }
    const next: FauxResponseStep = async (context) => {
      requests.push(readable(context.messages))
      return answer('after fork')
    }
    const t = await setup({ persistent: true, responses: [answer('a1'), held, next] })
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      await t.sessions.handleCommand(prompt('q1'))
      const running = t.sessions.handleCommand(prompt('q2'))
      await entered
      await t.sessions.handleCommand(fork(idOf(await lines(t.identity.sessionFile), 'a1')))
      await expect(running).resolves.toBe(true)
      expect(t.sent.filter((m) => m.type === 'error')).toEqual([])

      await t.sessions.handleCommand(prompt('q3'))
      release()
      expect(requests).toHaveLength(1)
      expect(requests[0]).toContain('q3')
      expect(requests[0]).not.toContain('q2')
    } finally {
      release()
      await t.sessions.stop()
    }
  })
})
