import { SessionManager } from '@earendil-works/pi-coding-agent'
import { type FauxResponseStep } from '@earendil-works/pi-ai'
import { describe, expect, it } from 'vitest'
import type { ResolvedModel } from '../electron/pi/durableSettings'
import { prompt, setup, useSessionRoot } from './helpers/durableSession'
import { answer, idOf, lines, readable, readies } from './helpers/forkSession'

/**
 * Phase 8.3q: `navigate_tree` against everything else a session does. Commands run concurrently,
 * so each of these needs two things happening at once, or a settings change or reload around the
 * navigation, which the plain cases never set up.
 */

useSessionRoot()

const nav = (entryId: string, requestId = 'n') => ({
  type: 'navigate_tree' as const,
  entryId,
  requestId,
})
const REPLY = 'Wait for the current response to finish before navigating the session tree.'
const MAINTENANCE =
  'Wait for the current compaction or tree navigation to finish before navigating the session tree.'
const OTHER: ResolvedModel = {
  info: { id: 'other', name: 'Other', provider: 'faux', reasoning: true, contextWindow: 2000 },
  thinkingLevels: ['off', 'low', 'high'],
}

/** A model call that waits for `release()`. */
function gate(text: string) {
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
    return answer(text)
  }
  return { step, release, entered }
}

function recording(requests: string[], text: string): FauxResponseStep {
  return async (context) => {
    requests.push(readable(context.messages))
    return answer(text)
  }
}

async function twoTurns(responses: FauxResponseStep[], extra: Parameters<typeof setup>[0] = {}) {
  const t = await setup({
    persistent: true,
    responses: [answer('a1'), answer('a2'), ...responses],
    ...extra,
  })
  await t.sessions.start('/work', { workspaceTrusted: false })
  await t.sessions.handleCommand(prompt('q1'))
  await t.sessions.handleCommand(prompt('q2'))
  return t
}

describe('durable navigate_tree races and state', () => {
  it('keeps the model and thinking level the session is using, not the ones at the target line', async () => {
    const t = await twoTurns([], { knownModels: { 'faux/other': OTHER } })
    try {
      await t.sessions.handleCommand({ type: 'set_thinking', level: 'high' })
      await t.sessions.handleCommand({ type: 'set_model', provider: 'faux', modelId: 'other' })
      await t.sessions.handleCommand(nav(idOf(await lines(t.identity.sessionFile), 'a1')))
      const agent = await t.harnesses[0]?.agentState()
      expect(agent?.thinkingLevel).toBe('high')
      expect(agent?.model?.modelId).toBe('other')
    } finally {
      await t.sessions.stop()
    }
  })

  it('refuses while a prompt is only just being admitted, before the store knows of it', async () => {
    const requests: string[] = []
    const t = await twoTurns([recording(requests, 'b1')])
    try {
      const a1 = idOf(await lines(t.identity.sessionFile), 'a1')
      // No await between the two commands: the harness has not seen the prompt yet.
      const running = t.sessions.handleCommand(prompt('q3'))
      await expect(t.sessions.handleCommand(nav(a1))).rejects.toThrow(REPLY)
      await running
      // The prompt landed where it was sent, on the branch the session was on.
      expect(requests[0]).toContain('q2')
    } finally {
      await t.sessions.stop()
    }
  })

  it('refuses while a compaction runs, and works once it is done', async () => {
    const held = gate('SUMMARY')
    const t = await twoTurns([held.step], { compaction: { keepRecentTokens: 1 } })
    try {
      const a1 = idOf(await lines(t.identity.sessionFile), 'a1')
      const compacting = t.sessions.handleCommand({ type: 'compact', requestId: 'c' })
      await held.entered
      await expect(t.sessions.handleCommand(nav(a1))).rejects.toThrow(MAINTENANCE)
      held.release()
      await compacting
      await t.sessions.handleCommand(nav(a1))
      expect(t.sent.filter((m) => m.type === 'navigate_tree_result')).toHaveLength(1)
    } finally {
      held.release()
      await t.sessions.stop()
    }
  })

  it('refuses a second navigation while one is in progress', async () => {
    const t = await twoTurns([])
    try {
      const file = await lines(t.identity.sessionFile)
      const first = t.sessions.handleCommand(nav(idOf(file, 'a1'), 'n1'))
      await expect(t.sessions.handleCommand(nav(idOf(file, 'q1'), 'n2'))).rejects.toThrow(
        MAINTENANCE
      )
      await first
      expect(t.harnesses[0]?.conversationIds()).toHaveLength(2)
    } finally {
      await t.sessions.stop()
    }
  })

  it('makes a prompt that arrives during a navigation wait for it', async () => {
    const requests: string[] = []
    const t = await twoTurns([recording(requests, 'b1')])
    try {
      const a1 = idOf(await lines(t.identity.sessionFile), 'a1')
      const moving = t.sessions.handleCommand(nav(a1))
      const running = t.sessions.handleCommand(prompt('q3'))
      await Promise.all([moving, running])
      expect(requests[0]).toContain('q3')
      expect(requests[0]).not.toContain('q2')
    } finally {
      await t.sessions.stop()
    }
  })

  it('reloads onto the branch it moved to even before that branch has a message', async () => {
    const requests: string[] = []
    const t = await twoTurns([recording(requests, 'b1')])
    try {
      await t.sessions.handleCommand(nav(idOf(await lines(t.identity.sessionFile), 'a1')))
      await t.sessions.handleCommand({ type: 'reload_session', requestId: 'r' })

      // What the SDK reads from the file's last line is what the session now continues from.
      const manager = SessionManager.open(t.identity.sessionFile, undefined, '/work')
      const context = readable(manager.buildSessionContext().messages)
      expect(context).toContain('q1')
      expect(context).not.toContain('q2')

      await t.sessions.handleCommand(prompt('q3'))
      expect(requests[0]).toContain('q1')
      expect(requests[0]).not.toContain('q2')
      expect(readies(t.sent)).toHaveLength(2)
    } finally {
      await t.sessions.stop()
    }
  })

  it('treats the branch marker as nothing: the same place twice changes nothing', async () => {
    const t = await twoTurns([])
    try {
      const a1 = idOf(await lines(t.identity.sessionFile), 'a1')
      await t.sessions.handleCommand(nav(a1, 'n1'))
      await t.sessions.handleCommand(nav(a1, 'n2'))
      expect(t.harnesses[0]?.conversationIds()).toHaveLength(2)
      expect(t.sent.filter((m) => m.type === 'navigate_tree_result').at(-1)).toMatchObject({
        result: { cancelled: false, leafId: a1 },
      })
    } finally {
      await t.sessions.stop()
    }
  })

  it('hands back the first message of a branch for editing, continuing from the real line before it', async () => {
    const t = await twoTurns([answer('b1')])
    try {
      const a1 = idOf(await lines(t.identity.sessionFile), 'a1')
      await t.sessions.handleCommand(nav(a1, 'n1'))
      await t.sessions.handleCommand(prompt('q3'))
      // q3's parent is the branch marker; the place to continue from is the line before that.
      await t.sessions.handleCommand(nav(idOf(await lines(t.identity.sessionFile), 'q3'), 'n2'))
      expect(t.sent.filter((m) => m.type === 'navigate_tree_result').at(-1)).toMatchObject({
        result: { cancelled: false, leafId: a1, editorText: 'q3' },
      })
    } finally {
      await t.sessions.stop()
    }
  })

  it('refuses while a queued message is running, which only the store knows of', async () => {
    const held = gate('late')
    const t = await twoTurns([held.step])
    try {
      const a1 = idOf(await lines(t.identity.sessionFile), 'a1')
      // Returns once admitted; the run it started goes on in the background.
      await t.sessions.handleCommand({ type: 'follow_up', text: 'q3' })
      await held.entered
      await expect(t.sessions.handleCommand(nav(a1))).rejects.toThrow(REPLY)
      held.release()
    } finally {
      held.release()
      await t.sessions.stop()
    }
  })

  it('refuses while a compaction the session did not start is running, which only the store knows of', async () => {
    const held = gate('SUMMARY')
    const t = await twoTurns([held.step], { compaction: { keepRecentTokens: 1 } })
    try {
      const a1 = idOf(await lines(t.identity.sessionFile), 'a1')
      // Straight to the harness, as pi-durable's own automatic compaction would: no command, so
      // none of the session's counters know of it.
      const compacting = t.harnesses[0]?.compact()
      await held.entered
      await expect(t.sessions.handleCommand(nav(a1))).rejects.toThrow(MAINTENANCE)
      held.release()
      await compacting
    } finally {
      held.release()
      await t.sessions.stop()
    }
  })

  it("refuses while the user's own shell command runs, and records one sent mid-navigation on the new branch", async () => {
    const t = await twoTurns([])
    try {
      const a1 = idOf(await lines(t.identity.sessionFile), 'a1')
      const running = t.sessions.handleCommand({
        type: 'execute_bash',
        requestId: 'b1',
        command: 'sleep 0.3; echo SLOW',
      })
      await expect(t.sessions.handleCommand(nav(a1))).rejects.toThrow(REPLY)
      await running

      const moving = t.sessions.handleCommand(nav(a1, 'n2'))
      const quick = t.sessions.handleCommand({
        type: 'execute_bash',
        requestId: 'b2',
        command: 'echo ONNEW',
      })
      await Promise.all([moving, quick])
      const manager = SessionManager.open(t.identity.sessionFile, undefined, '/work')
      const context = JSON.stringify(manager.buildSessionContext().messages)
      expect(context).toContain('ONNEW')
      expect(context).not.toContain('q2')
    } finally {
      await t.sessions.stop()
    }
  })

  it('applies a model change and a rename sent during a navigation to the branch it ends on', async () => {
    const t = await twoTurns([], { knownModels: { 'faux/other': OTHER } })
    try {
      const a1 = idOf(await lines(t.identity.sessionFile), 'a1')
      const moving = t.sessions.handleCommand(nav(a1))
      const model = t.sessions.handleCommand({
        type: 'set_model',
        provider: 'faux',
        modelId: 'other',
      })
      const name = t.sessions.handleCommand({ type: 'set_session_name', name: 'Renamed' })
      await Promise.all([moving, model, name])
      expect((await t.harnesses[0]?.agentState())?.model?.modelId).toBe('other')
      expect((await t.harnesses[0]?.stats())?.sessionName).toBe('Renamed')
    } finally {
      await t.sessions.stop()
    }
  })

  it('makes a reload sent during a navigation resume with the branch the navigation made', async () => {
    const requests: string[] = []
    const t = await twoTurns([recording(requests, 'b1')])
    try {
      const a1 = idOf(await lines(t.identity.sessionFile), 'a1')
      const moving = t.sessions.handleCommand(nav(a1))
      const reloading = t.sessions.handleCommand({ type: 'reload_session', requestId: 'r' })
      await Promise.all([moving, reloading])
      await t.sessions.handleCommand(prompt('q3'))
      expect(requests[0]).toContain('q3')
      expect(requests[0]).not.toContain('q2')
      // Both branches survive the reload: the old branch is still in the file.
      expect(JSON.stringify(await lines(t.identity.sessionFile))).toContain('q2')
    } finally {
      await t.sessions.stop()
    }
  })
})
