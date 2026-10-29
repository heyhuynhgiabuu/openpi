import { type FauxResponseStep } from '@earendil-works/pi-ai'
import { describe, expect, it } from 'vitest'
import { prompt, setup, useSessionRoot } from './helpers/durableSession'
import { answer, readable } from './helpers/forkSession'

/**
 * Replacing a durable session while it is running. `start_session` goes through `stop()`, which must
 * abort the run first: pi-durable keeps an unfinished run pending in the store, so a run left to die
 * on a closed harness is what the next message has to work around — and in the store it is still
 * `q2`, unpicked, which re-runs the abandoned prompt.
 */

useSessionRoot()

/** A model call that waits for `release()`, or rejects when its signal aborts. */
function gate(text: string) {
  let release = () => {}
  let entered = () => {}
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  const enteredPromise = new Promise<void>((resolve) => {
    entered = resolve
  })
  const step: FauxResponseStep = async (_context, options) => {
    entered()
    await new Promise<void>((resolve, reject) => {
      void released.then(resolve)
      options?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    })
    return answer(text)
  }
  return { step, release, entered: enteredPromise }
}

describe('replacing a durable session mid-run', () => {
  it('aborts the run instead of letting it die on a closed harness', async () => {
    const requests: string[] = []
    const held = gate('ABANDONED-ANSWER')
    const record = (context: { messages: readonly { role: string }[] }) => {
      requests.push(readable(context.messages))
      return answer('later')
    }
    const t = await setup({ persistent: true, responses: [answer('a1'), held.step, record] })
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      await t.sessions.handleCommand(prompt('q1'))
      const running = t.sessions.handleCommand(prompt('q2')).then(
        () => 'handled',
        (error: unknown) => String(error)
      )
      await held.entered

      await t.sessions.start('/work', { workspaceTrusted: false })
      held.release()
      // Aborted by the replacement: the run settles as an aborted submission, not as a crash on a
      // harness that was closed underneath it (which is what the store then leaves pending).
      expect(await running).toBe('handled')

      // And the new session answers the next message rather than picking up the abandoned one.
      await t.sessions.handleCommand(prompt('q3'))
      expect(requests).toHaveLength(1)
      expect(requests[0]).toContain('q3')
      expect(requests[0]).not.toContain('ABANDONED-ANSWER')
      expect(t.logs.filter((line) => line.includes('unanswered'))).toEqual([])
    } finally {
      held.release()
      await t.sessions.stop()
    }
  })
})
