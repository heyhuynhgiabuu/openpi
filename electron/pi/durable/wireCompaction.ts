import type { Message } from '@earendil-works/pi-ai'
import { CompactionEntry } from '@earendil-works/pi-durable'
import type { EntryRecord } from '@earendil-works/pi-durable'
import { isSummaryWrapped, messageText, unwrapSummary } from './text'

/**
 * Phase 8.3m: a manual or automatic compaction as the renderer expects it.
 *
 * pi-durable writes the summary as an ordinary user message (`pi.compaction` entry), so passed
 * through it would show up as a chat bubble the user never wrote. The renderer instead wants the
 * summary on `compaction_end.result`. This tracker withholds the summary's `message_start` /
 * `message_end` and hands the text to the closing event.
 *
 * Only a wrapped summary seen while a compaction is open is withheld: a real user message can
 * arrive in the same window (a steer while the compaction runs) and must still be shown.
 */

export interface CompactionTracker {
  begin: () => void
  /** True when this `message_start` is the summary and must not be forwarded. */
  swallowStart: (message: Message) => boolean
  /** True when this entry is the summary and must not be forwarded. */
  swallowEnd: (entry: EntryRecord) => boolean
  /** The `compaction_end` the renderer reads, closing the compaction opened by `begin`. */
  end: (reason: string, error: string | undefined) => Record<string, unknown>
}

/** What the SDK reports when there is nothing to summarize; pi-durable ends silently instead. */
export const NOTHING_TO_COMPACT = 'Nothing to compact (session too small)'

export function createCompactionTracker(): CompactionTracker {
  let open = false
  let summary: string | undefined
  return {
    begin() {
      open = true
      summary = undefined
    },
    swallowStart: (message) => open && isSummaryWrapped(messageText(message)),
    swallowEnd(entry) {
      if (!open || !CompactionEntry.is(entry)) return false
      summary = unwrapSummary(messageText(entry.model?.[0]) ?? '')
      return true
    },
    end(reason, error) {
      const end: Record<string, unknown> = {
        type: 'compaction_end',
        reason,
        aborted: false,
        willRetry: false,
      }
      if (error !== undefined) end.errorMessage = error
      else if (summary === undefined) end.errorMessage = NOTHING_TO_COMPACT
      // `tokensBefore` is not tracked per compaction here; the renderer then says "Context compacted".
      else end.result = { summary, tokensBefore: 0 }
      open = false
      summary = undefined
      return end
    },
  }
}
