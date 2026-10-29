import { readFile } from 'node:fs/promises'
import type { FauxResponseStep } from '@earendil-works/pi-ai'
import { fauxAssistantMessage, fauxText } from '@earendil-works/pi-ai'
import { describe, expect, it } from 'vitest'
import { prompt, setup, useSessionRoot, waitFor } from './helpers/durableSession'

/**
 * ROADMAP Phase 8 gate condition 5: "a restart during a run does not resume the in-flight prompt."
 *
 * pi-durable already keeps an unsettled task and turns it back into a pending one on open, but it
 * does not dispatch until `Harness.resume()` is called (`dist/harness/scheduler.js`). Nothing called
 * it, so an interrupted prompt was not resumed by the restart: it ran later, silently, behind
 * whichever command happened to enable scheduling next.
 *
 * The test has to reproduce a *crash*, and two things in the session layer make that subtle:
 *
 * - `stop()` aborts before closing (`durableSession.ts:78-100`), and an abort marks the task
 *   abandoned — so `stop()` cannot stand in for a killed process. The harness is closed directly
 *   instead, which leaves the task exactly as a process death does.
 * - a resume needs the exported file, because that is the only thing carrying the store id. The file
 *   is written mid-run by `set_session_name`, whose export is not gated on the run; every other
 *   exporting path either waits for the run or aborts it.
 */

useSessionRoot()

/** A model call that never resolves on its own, so the run is genuinely in flight when we stop. */
function heldUntilClosed(entered: { resolve: () => void }): FauxResponseStep {
  return (_context, options) =>
    new Promise((_resolve, reject) => {
      entered.resolve()
      // Only an abort signal ends this, and the test never sends one.
      options?.signal?.addEventListener('abort', () => reject(new Error('run ended')))
    })
}

/** What the resumed run answers. It must come from the *second* runtime's script: the first never
 * reaches a second model call. */
const RESUMED = 'answer after the restart'

describe('a restart during a run', () => {
  it('resumes the interrupted prompt on reopen, without a new one', async () => {
    let enter = () => {}
    const entered = new Promise<void>((resolve) => {
      enter = resolve
    })
    const first = await setup({
      persistent: true,
      responses: [heldUntilClosed({ resolve: enter })],
    })
    await first.sessions.start('/work', { workspaceTrusted: false })

    // Put the turn in flight and let the model call start.
    const running = first.sessions.handleCommand(prompt('a long task'))
    running.catch(() => undefined)
    await entered

    // Export while the run is still in flight: the file must name this session's store, or there is
    // nothing for a restart to resume into.
    await first.sessions.handleCommand({ type: 'set_session_name', name: 'crashed mid-run' })
    const exported = await readFile(first.identity.sessionFile, 'utf-8')
    expect(exported).toContain('openpi.durable')

    // The crash. Not `stop()`: that aborts first, and an aborted task is not resumed. Closing a
    // harness with a run still in flight lets that run's promise settle afterwards, so its rejection
    // is absorbed here rather than surfacing as an unhandled error.
    await first.harnesses[0]?.close()
    // The interrupted run never settles on its own once its harness is gone; absorb its rejection.
    await running.catch(() => undefined)

    // A runtime that never saw the first one, opening the file as a restart would.
    const after = await setup({
      persistent: true,
      sessionFile: first.identity.sessionFile,
      responses: [fauxAssistantMessage([fauxText(RESUMED)], { stopReason: 'stop' as const })],
    })
    try {
      expect(
        await after.sessions.resumeFrom('/work', first.identity.sessionFile, false, 'open-1')
      ).toBe(true)
      // The interrupted prompt runs again on its own, and its answer reaches the file the renderer
      // reads. No second prompt was sent.
      await waitFor(
        async () => (await readFile(first.identity.sessionFile, 'utf-8')).includes(RESUMED),
        'the resumed answer in the session file'
      )
      // The resumed run must announce itself. pi-durable only sends `run_start` when a run changes,
      // so a run that was already live before the crash starts again silently — and an unannounced
      // run means the app shows Send instead of Stop for work that may be running tools.
      const eventTypes = after.sent.flatMap((m) =>
        m.type === 'session_event' ? [String(m.event.type)] : []
      )
      // Exactly once: the resumed run must be announced, and a later `run_start` for the same run
      // (or an overflow snapshot mid-run) must not announce it a second time.
      expect(eventTypes.filter((type) => type === 'agent_start')).toHaveLength(1)
    } finally {
      await after.sessions.stop()
    }
  }, 30_000)
})
