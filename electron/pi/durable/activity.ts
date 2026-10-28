import type { Context } from '@earendil-works/chord'
import type { Harness } from '@earendil-works/pi-durable'

/** pi-durable's task kind for a compaction (a conversation can keep working while it summarizes). */
const COMPACTION_TASK_KIND = 'pi.compaction'

/**
 * What the store is doing right now, from pi-durable's own bookkeeping: a compaction, or anything
 * else live (a run, a tool, queued inputs and writes). Undefined when it is idle. This sees work
 * that began without this process noticing it, such as a queued message that started a run.
 */
export async function busyWith(
  harness: Harness,
  context: Context
): Promise<'compaction' | 'reply' | undefined> {
  const { tasks, submissions } = await harness.inspect(context)
  if (tasks.some((task) => task.record.kind === COMPACTION_TASK_KIND)) return 'compaction'
  return tasks.length > 0 || submissions.length > 0 ? 'reply' : undefined
}
