import type { Context } from '@earendil-works/chord'
import type { Conversation, Harness } from '@earendil-works/pi-durable'
import type { DurableCompaction } from './types'

/** Run a manual compaction to its end and say what came of it. */
export async function runCompaction(
  harness: Harness,
  conversation: Conversation,
  instructions: string | undefined,
  context: Context
): Promise<DurableCompaction> {
  const settled = await harness.waitForTask(
    await conversation.compact(instructions, context),
    context
  )
  const outcome = settled.state.outcome
  if (outcome.status === 'completed') {
    // pi-durable leaves both ids absent when there was nothing to summarize.
    const compacted =
      outcome.result.entryId !== undefined || outcome.result.submissionId !== undefined
    return compacted ? { status: 'compacted' } : { status: 'nothing' }
  }
  const detail = outcome.status === 'failed' ? outcome.error.message : outcome.status
  return { status: 'failed', message: `compaction ${detail}` }
}
