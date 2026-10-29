import type { SidecarMessage } from './sidecarTypes'
import type { ActiveSession } from './durableTypes'
import { countedUnlessAborted } from './durableActivity'
import { errorText } from './durablePrompt'

/**
 * The two ways a message reaches a durable session, kept out of `durableSession.ts` so that factory
 * stays inside the file-size rule. Both take text already expanded by the harness, so a `/template`
 * is substituted before the model reads it.
 */

/**
 * Say that a `/name` is not available, in the transcript rather than as an error: the SDK path does
 * the same, and the composer has already cleared the input.
 */
export function refuseCommand(
  session: ActiveSession,
  name: string,
  send: (message: SidecarMessage) => void
): void {
  if (session.closing) return
  send({
    type: 'session_event',
    event: {
      type: 'message_start',
      message: {
        role: 'custom',
        content: `${name} is not available on this runtime. Prompt templates and /skill:name are supported.`,
        details: { level: 'warn' },
        timestamp: Date.now(),
      },
    },
  })
}

interface SendHooks {
  log: (level: 'warn' | 'error', message: string) => void
  exportNow: () => Promise<void>
}

/** A run can end without producing an answer; say so unless we cancelled it ourselves. */
function report(
  session: ActiveSession,
  result: { status: string; reason?: string },
  hooks: SendHooks
): void {
  if (result.status !== 'unanswered' || session.abortRequested) return
  hooks.log(
    'warn',
    `[durable] run ended without an answer${result.reason ? `: ${result.reason}` : ''}`
  )
}

export async function promptOnce(
  session: ActiveSession,
  text: string,
  hooks: SendHooks
): Promise<void> {
  session.abortRequested = false
  const result = await countedUnlessAborted(session.activity, () => session.harness.prompt(text))
  if (result) report(session, result, hooks)
  await hooks.exportNow()
}

/**
 * Steer / follow-up: returns once the message is admitted, like the SDK's `steer()`. The run it
 * joins (or starts, when idle) is tracked in the background so its outcome is still exported.
 */
export async function queueOnce(
  session: ActiveSession,
  text: string,
  mode: 'steer' | 'followUp',
  hooks: SendHooks
): Promise<void> {
  session.abortRequested = false
  const queued = await countedUnlessAborted(session.activity, () =>
    session.harness.queue(text, mode)
  )
  if (!queued) return
  void queued.settled
    .then(async (result) => {
      if (session.closing) return
      report(session, result, hooks)
      await hooks.exportNow()
    })
    .catch((error) => {
      if (!session.closing)
        hooks.log('error', `[durable] queued message failed: ${errorText(error)}`)
    })
}
