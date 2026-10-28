import { NOTHING_TO_COMPACT } from './durable/wireCompaction'
import type { DurableHarness } from './durable/types'
import type { SidecarCommand, SidecarMessage } from './sidecarTypes'

/**
 * Phase 8.3m: the `compact` command on a durable session.
 *
 * The SDK aborts a running turn before compacting, so this does too. The outcome goes to the
 * requester as `compact_result`, or as an `error` (nothing to compact, or a failure); the card the
 * user sees comes from the event feed, not from this reply.
 */
export async function runCompact(
  harness: Pick<DurableHarness, 'abort' | 'compact'>,
  cmd: Extract<SidecarCommand, { type: 'compact' }>,
  send: (message: SidecarMessage) => void
): Promise<boolean> {
  await harness.abort()
  const outcome = await harness.compact(cmd.customInstructions)
  if (outcome.status === 'compacted') {
    send({ type: 'compact_result', requestId: cmd.requestId })
    return true
  }
  const message = outcome.status === 'nothing' ? NOTHING_TO_COMPACT : outcome.message
  send({ type: 'error', requestId: cmd.requestId, message })
  return false
}
