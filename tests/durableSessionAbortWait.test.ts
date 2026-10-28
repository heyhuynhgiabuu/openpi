import { type FauxResponseStep } from '@earendil-works/pi-ai'
import { describe, expect, it } from 'vitest'
import { prompt, setup, useSessionRoot } from './helpers/durableSession'
import { answer, idOf, lines, readable } from './helpers/forkSession'

/** A message that waits for a navigation is dropped when the user presses stop meanwhile. */

useSessionRoot()

async function ready(requests: string[]) {
  const model: FauxResponseStep = async (context) => {
    requests.push(readable(context.messages))
    return answer('late')
  }
  const t = await setup({ persistent: true, responses: [answer('a1'), answer('a2'), model] })
  await t.sessions.start('/work', { workspaceTrusted: false })
  await t.sessions.handleCommand(prompt('q1'))
  await t.sessions.handleCommand(prompt('q2'))
  return t
}

const navigate = (entryId: string) => ({ type: 'navigate_tree' as const, entryId, requestId: 'n' })

describe('a message waiting for a navigation', () => {
  it('is not sent when the user aborts while it waits', async () => {
    const requests: string[] = []
    const t = await ready(requests)
    try {
      const a1 = idOf(await lines(t.identity.sessionFile), 'a1')
      const moving = t.sessions.handleCommand(navigate(a1))
      const waiting = t.sessions.handleCommand(prompt('q3'))
      await t.sessions.handleCommand({ type: 'abort' })
      await Promise.all([moving, waiting])
      expect(requests).toEqual([])
    } finally {
      await t.sessions.stop()
    }
  })

  it('drops a queued follow-up the same way', async () => {
    const requests: string[] = []
    const t = await ready(requests)
    try {
      const a1 = idOf(await lines(t.identity.sessionFile), 'a1')
      const moving = t.sessions.handleCommand(navigate(a1))
      const waiting = t.sessions.handleCommand({ type: 'follow_up', text: 'q3' })
      await t.sessions.handleCommand({ type: 'abort' })
      await Promise.all([moving, waiting])
      // A queued message is admitted before its run starts: a submitted one is visible as busy here.
      expect(await t.harnesses[0]?.busy()).toBeUndefined()
      // ...and it runs in the background, so give it the time to reach the model.
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(requests).toEqual([])
    } finally {
      await t.sessions.stop()
    }
  })

  it('is still sent when the abort came before it', async () => {
    const requests: string[] = []
    const t = await ready(requests)
    try {
      await t.sessions.handleCommand({ type: 'abort' })
      const a1 = idOf(await lines(t.identity.sessionFile), 'a1')
      const moving = t.sessions.handleCommand(navigate(a1))
      const waiting = t.sessions.handleCommand(prompt('q3'))
      await Promise.all([moving, waiting])
      expect(requests).toHaveLength(1)
      expect(requests[0]).toContain('q3')
    } finally {
      await t.sessions.stop()
    }
  })
})
