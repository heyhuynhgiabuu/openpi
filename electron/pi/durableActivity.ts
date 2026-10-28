/**
 * What a durable session has in flight, counted at the moment a command is accepted.
 *
 * Commands run concurrently (only session replacements wait), and the harness learns of a prompt or
 * a compaction a little after the command arrives. A command that must not overlap them
 * (`navigate_tree`) therefore reads these counters, which move synchronously, as well as the store.
 */
export interface Activity {
  /** Prompts and queued messages being admitted or run. */
  replies: number
  /** Compactions and tree navigations. */
  maintenance: number
  /** A tree navigation in progress: commands that act on the conversation wait for it. */
  navigation?: Promise<unknown>
}

export function newActivity(): Activity {
  return { replies: 0, maintenance: 0 }
}

/** Run `work` as counted activity, after any tree navigation that is in progress. */
export async function counted<T>(
  activity: Activity,
  kind: 'replies' | 'maintenance',
  work: () => Promise<T>
): Promise<T> {
  activity[kind] += 1
  try {
    await activity.navigation
    return await work()
  } finally {
    activity[kind] -= 1
  }
}
