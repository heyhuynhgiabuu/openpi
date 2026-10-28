import { type FauxResponseStep } from '@earendil-works/pi-ai'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { answer, fork, idOf, lines, mentions, readies, textOf } from './helpers/forkSession'
import { prompt, sessionRoot, setup, useSessionRoot, waitFor } from './helpers/durableSession'

/** Phase 8.3p: the awkward cases of `fork_session`: compaction, tied timestamps, a running reply. */

useSessionRoot()

describe('durable fork_session edge cases', () => {
  it('forks at the right line after a compaction, from the whole history', async () => {
    const t = await setup({
      persistent: true,
      responses: [answer('a1'), answer('a2'), answer('SUMMARY'), answer('a3')],
      compaction: { keepRecentTokens: 1 },
    })
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      await t.sessions.handleCommand(prompt('q1'))
      await t.sessions.handleCommand(prompt('q2'))
      await t.sessions.handleCommand({ type: 'compact', requestId: 'c' })
      await t.sessions.handleCommand(prompt('q3'))

      const parent = await lines(t.identity.sessionFile)
      const at = parent.findIndex((line) => line.type === 'message' && textOf(line).includes('q3'))
      expect(parent.some((line) => line.type === 'compaction')).toBe(true)
      await t.sessions.handleCommand(fork(idOf(parent, 'q3')))

      // The child is exactly the parent's first lines through q3, compaction included.
      const child = await lines(readies(t.sent).at(-1)?.payload.sessionFile ?? '')
      expect(child.map((line) => line.type)).toEqual(
        parent.slice(0, at + 1).map((line) => line.type)
      )
      expect(mentions(child, 'q1')).toBe(true)
      expect(mentions(child, 'a3')).toBe(false)
    } finally {
      await t.sessions.stop()
    }
  })

  it('refuses to guess between messages sent at the same moment', async () => {
    let release = () => {}
    let enter = () => {}
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    const entered = new Promise<void>((resolve) => {
      enter = resolve
    })
    const held: FauxResponseStep = async (_context, options) => {
      enter()
      await new Promise<void>((resolve, reject) => {
        void released.then(resolve)
        options?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
      return answer('first')
    }
    const t = await setup({
      persistent: true,
      responses: [held, answer('b'), answer('c'), answer('d')],
    })
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      const running = t.sessions.handleCommand(prompt('q1'))
      await entered
      await t.sessions.handleCommand({ type: 'steer', text: 'steer one' })
      await t.sessions.handleCommand({ type: 'follow_up', text: 'follow one' })
      release()
      await running
      await waitFor(
        async () => mentions(await lines(t.identity.sessionFile), 'follow one'),
        'the queued messages to be placed'
      )

      const all = await lines(t.identity.sessionFile)
      const stamps = (word: string) =>
        all.find((line) => textOf(line).includes(word))?.message?.timestamp
      // pi-durable places a steer and a follow-up in one commit, with one clock reading.
      expect(stamps('steer one')).toBe(stamps('follow one'))

      await expect(t.sessions.handleCommand(fork(`u-${stamps('follow one')}`))).rejects.toThrow(
        /ambiguous/
      )
      expect(t.sessions.isActive()).toBe(true)
      expect(readies(t.sent)).toHaveLength(1)
    } finally {
      release()
      await t.sessions.stop()
    }
  })

  it('does not touch a running reply when the entry turns out not to exist', async () => {
    let release = () => {}
    let enter = () => {}
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    const entered = new Promise<void>((resolve) => {
      enter = resolve
    })
    const held: FauxResponseStep = async (_context, options) => {
      enter()
      await new Promise<void>((resolve, reject) => {
        void released.then(resolve)
        options?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
      return answer('finished normally')
    }
    const t = await setup({ persistent: true, responses: [held] })
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      const running = t.sessions.handleCommand(prompt('q1'))
      await entered
      await expect(t.sessions.handleCommand(fork('deadbeef'))).rejects.toThrow('entry not found')
      release()
      await running
      expect(mentions(await lines(t.identity.sessionFile), 'finished normally')).toBe(true)
    } finally {
      release()
      await t.sessions.stop()
    }
  })

  it('restores the parent when the fork cannot be started, and announces nothing for the fork', async () => {
    const t = await setup({ persistent: true, answers: ['a1', 'a2'] })
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      await t.sessions.handleCommand(prompt('q1'))
      // The fork's file cannot be written: its path is a directory.
      await mkdir(join(sessionRoot(), 'sessions', 'sess-2.jsonl'), { recursive: true })
      await expect(
        t.sessions.handleCommand(fork(idOf(await lines(t.identity.sessionFile), 'a1')))
      ).rejects.toThrow()

      const announced = readies(t.sent)
      expect(announced.map((r) => r.payload.sessionId)).toEqual(['sess-1', 'sess-1'])
      // The restored parent answers no request: the failed fork's own request fails instead.
      expect(announced.at(-1)?.requestId).toBeUndefined()
      expect(t.sessions.isActive()).toBe(true)

      await t.sessions.handleCommand(prompt('q2'))
      expect(mentions(await lines(t.identity.sessionFile), 'a2')).toBe(true)
    } finally {
      await t.sessions.stop()
    }
  })

  it('restores the parent with the trust it had, not the trust the fork request carried', async () => {
    const t = await setup({ persistent: true, answers: ['a1'] })
    await t.sessions.start('/work', { workspaceTrusted: true })
    try {
      await t.sessions.handleCommand(prompt('q1'))
      await mkdir(join(sessionRoot(), 'sessions', 'sess-2.jsonl'), { recursive: true })
      const request = {
        ...fork(idOf(await lines(t.identity.sessionFile), 'a1')),
        workspaceTrusted: false,
      }
      await expect(t.sessions.handleCommand(request)).rejects.toThrow()
      // start (trusted), fork (as requested), restored parent (trusted again).
      expect(t.trusts).toEqual([true, false, true])
    } finally {
      await t.sessions.stop()
    }
  })

  it('leaves no session behind when a reload cannot write its file', async () => {
    const t = await setup({ persistent: true, answers: ['a1'] })
    await t.sessions.start('/work', { workspaceTrusted: false })
    await t.sessions.handleCommand(prompt('q1'))
    // The file is replaced by a directory, so the first export of the reloaded session fails.
    await rm(t.identity.sessionFile, { force: true })
    await mkdir(t.identity.sessionFile, { recursive: true })
    await expect(
      t.sessions.handleCommand({ type: 'reload_session', requestId: 'r' })
    ).rejects.toThrow()
    expect(t.sessions.isActive()).toBe(false)
    // Only the original announcement: the failed reload announced nothing.
    expect(readies(t.sent)).toHaveLength(1)
  })
})
