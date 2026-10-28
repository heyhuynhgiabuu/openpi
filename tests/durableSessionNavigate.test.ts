import { type FauxResponseStep } from '@earendil-works/pi-ai'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'
import type { SidecarMessage } from '../electron/pi/sidecarTypes'
import { prompt, setup, useSessionRoot, waitFor } from './helpers/durableSession'
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
 * Phase 8.3q: `navigate_tree` on a durable session: continue from an earlier line in the same
 * file. The abandoned branch stays in the exported tree, the next message hangs off the chosen
 * line, and the model sees only the path to it.
 */

useSessionRoot()

function navigate(entryId: string, requestId = 'n1') {
  return { type: 'navigate_tree' as const, entryId, requestId }
}

type Result = Extract<SidecarMessage, { type: 'navigate_tree_result' }>['result']
const resultOf = (sent: SidecarMessage[]): Result | undefined =>
  sent.filter((m) => m.type === 'navigate_tree_result').at(-1)?.result

/** A session with two answered turns, whose model requests are recorded. */
async function twoTurns(more = 3) {
  const requests: string[] = []
  const step =
    (text: string): FauxResponseStep =>
    async (context) => {
      requests.push(readable(context.messages))
      return answer(text)
    }
  const t = await setup({
    persistent: true,
    responses: ['a1', 'a2', ...Array.from({ length: more }, (_, i) => `b${i + 1}`)].map(step),
  })
  await t.sessions.start('/work', { workspaceTrusted: false })
  await t.sessions.handleCommand(prompt('q1'))
  await t.sessions.handleCommand(prompt('q2'))
  return { t, requests }
}

describe('durable navigate_tree', () => {
  it('continues from an earlier reply in the same file, as a branch', async () => {
    const { t, requests } = await twoTurns()
    try {
      const before = await lines(t.identity.sessionFile)
      const a1 = idOf(before, 'a1')
      await t.sessions.handleCommand(navigate(a1))

      expect(resultOf(t.sent)).toEqual({ cancelled: false, leafId: a1 })
      // Same session: no new announcement, same file.
      expect(readies(t.sent)).toHaveLength(1)

      await t.sessions.handleCommand(prompt('q3'))
      const after = await lines(t.identity.sessionFile)
      // Nothing was lost and nothing is written twice; the new message hangs off the chosen line.
      expect(after.slice(0, before.length)).toEqual(before)
      const q3 = after.find((line) => textOf(line).includes('q3'))
      expect(q3?.parentId).toBe(a1)
      expect(after.filter((line) => textOf(line).includes('q1'))).toHaveLength(1)
      // The model saw the path to the chosen line, not the abandoned turn.
      const last = requests.at(-1) ?? ''
      expect(last).toContain('q1')
      expect(last).toContain('q3')
      expect(last).not.toContain('q2')
    } finally {
      await t.sessions.stop()
    }
  })

  it('is read back by the real SDK with the new branch as its leaf', async () => {
    const { t } = await twoTurns()
    try {
      await t.sessions.handleCommand(navigate(idOf(await lines(t.identity.sessionFile), 'a1')))
      await t.sessions.handleCommand(prompt('q3'))
      const manager = SessionManager.open(t.identity.sessionFile, undefined, '/work')
      const context = readable(manager.buildSessionContext().messages)
      expect(context).toContain('q3')
      expect(context).toContain('a1')
      expect(context).not.toContain('q2')
      // Both branches are in the file's tree.
      expect(JSON.stringify(manager.getTree())).toContain('q2')
    } finally {
      await t.sessions.stop()
    }
  })

  it('hands a user message back for editing and continues from the message before it', async () => {
    const { t } = await twoTurns()
    try {
      const file = await lines(t.identity.sessionFile)
      await t.sessions.handleCommand(navigate(idOf(file, 'q2')))
      expect(resultOf(t.sent)).toEqual({
        cancelled: false,
        leafId: idOf(file, 'a1'),
        editorText: 'q2',
      })

      await t.sessions.handleCommand(prompt('q2 reworded'))
      const after = await lines(t.identity.sessionFile)
      expect(after.find((line) => textOf(line).includes('q2 reworded'))?.parentId).toBe(
        idOf(file, 'a1')
      )
    } finally {
      await t.sessions.stop()
    }
  })

  it('starts a new root from the first message, keeping the model in use', async () => {
    const { t, requests } = await twoTurns()
    try {
      const file = await lines(t.identity.sessionFile)
      await t.sessions.handleCommand(navigate(idOf(file, 'q1')))
      expect(resultOf(t.sent)).toEqual({ cancelled: false, leafId: null, editorText: 'q1' })

      await t.sessions.handleCommand(prompt('a different start'))
      const after = await lines(t.identity.sessionFile)
      expect(after.find((line) => textOf(line).includes('a different start'))?.parentId).toBeNull()
      expect(
        after.filter((line) => line.type === 'message' && line.parentId === null)
      ).toHaveLength(2)
      expect(requests.at(-1)).not.toContain('q1')
    } finally {
      await t.sessions.stop()
    }
  })

  it('does nothing when the leaf is already there', async () => {
    const { t } = await twoTurns()
    try {
      const file = await lines(t.identity.sessionFile)
      const tip = idOf(file, 'a2')
      await t.sessions.handleCommand(navigate(tip))
      expect(resultOf(t.sent)).toEqual({ cancelled: false, leafId: tip })
      expect(t.harnesses[0]?.conversationIds()).toHaveLength(1)
    } finally {
      await t.sessions.stop()
    }
  })

  it('can return to an abandoned branch, whose lines keep their ids', async () => {
    const { t, requests } = await twoTurns()
    try {
      const first = await lines(t.identity.sessionFile)
      const a2 = idOf(first, 'a2')
      await t.sessions.handleCommand(navigate(idOf(first, 'a1')))
      await t.sessions.handleCommand(prompt('q3'))
      expect(idOf(await lines(t.identity.sessionFile), 'a2')).toBe(a2)

      await t.sessions.handleCommand(navigate(a2))
      expect(resultOf(t.sent)?.leafId).toBe(a2)
      await t.sessions.handleCommand(prompt('q4'))
      const last = requests.at(-1) ?? ''
      expect(last).toContain('q2')
      expect(last).toContain('q4')
      expect(last).not.toContain('q3')
    } finally {
      await t.sessions.stop()
    }
  })

  it('streams events from the new branch', async () => {
    const { t } = await twoTurns()
    try {
      await t.sessions.handleCommand(navigate(idOf(await lines(t.identity.sessionFile), 'a1')))
      const before = t.sent.filter(
        (m) => m.type === 'session_event' && m.event.type === 'agent_end'
      ).length
      await t.sessions.handleCommand(prompt('q3'))
      await waitFor(
        () =>
          t.sent.filter((m) => m.type === 'session_event' && m.event.type === 'agent_end').length >
          before,
        'agent_end from the new branch'
      )
    } finally {
      await t.sessions.stop()
    }
  })

  it('survives a reload on the branch it moved to, with every branch still in the file', async () => {
    const { t, requests } = await twoTurns()
    try {
      await t.sessions.handleCommand(navigate(idOf(await lines(t.identity.sessionFile), 'a1')))
      await t.sessions.handleCommand(prompt('q3'))
      await t.sessions.handleCommand({ type: 'reload_session', requestId: 'r' })
      await t.sessions.handleCommand(prompt('q4'))

      const last = requests.at(-1) ?? ''
      expect(last).toContain('q3')
      expect(last).not.toContain('q2')
      const file = await lines(t.identity.sessionFile)
      expect(mentions(file, 'q2') && mentions(file, 'q4')).toBe(true)
    } finally {
      await t.sessions.stop()
    }
  })

  it('lets a fork start from a line on a branch the session has left', async () => {
    const { t } = await twoTurns()
    try {
      const first = await lines(t.identity.sessionFile)
      const a2 = idOf(first, 'a2')
      await t.sessions.handleCommand(navigate(idOf(first, 'a1')))
      await t.sessions.handleCommand(prompt('q3'))
      await t.sessions.handleCommand(fork(a2))
      const child = await lines(readies(t.sent).at(-1)?.payload.sessionFile ?? '')
      expect(mentions(child, 'a2') && mentions(child, 'q2')).toBe(true)
      expect(mentions(child, 'q3')).toBe(false)
    } finally {
      await t.sessions.stop()
    }
  })

  it('refuses while a reply streams, and for an unknown entry', async () => {
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
      return answer('late')
    }
    const t = await setup({ persistent: true, responses: [answer('a1'), held] })
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      await t.sessions.handleCommand(prompt('q1'))
      const running = t.sessions.handleCommand(prompt('q2'))
      await entered
      const a1 = idOf(await lines(t.identity.sessionFile), 'a1')
      await expect(t.sessions.handleCommand(navigate(a1))).rejects.toThrow(
        'Wait for the current response to finish before navigating the session tree.'
      )
      release()
      await running
      await expect(t.sessions.handleCommand(navigate('deadbeef'))).rejects.toThrow(
        'Entry deadbeef not found'
      )
      expect(t.sessions.isActive()).toBe(true)
    } finally {
      release()
      await t.sessions.stop()
    }
  })
})
