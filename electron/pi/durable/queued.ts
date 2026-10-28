/**
 * Text of queued messages by submission id.
 *
 * `inbox_update` carries only ids, but the renderer shows pending messages as text. The event fires
 * *inside* `submit()`, before the submission's id is known to the caller, so the text is registered
 * first and the first unknown id claims the oldest registration (items arrive in id order).
 */
export interface QueuedTexts {
  /** Text for an id, claiming the oldest unclaimed registration if the id is new. */
  textFor: (id: number) => string | undefined
  /** Register a message about to be submitted. */
  expect: (text: string) => void
  /** The submission failed: drop its registration. */
  cancel: (text: string) => void
  /** The submission returned `id`; if no event named it yet, bind its text now. */
  bind: (id: number, text: string) => void
  /** Settled: it can no longer appear in an `inbox_update`, so its text can go. */
  forget: (id: number) => void
}

export function createQueuedTexts(): QueuedTexts {
  const byId = new Map<number, string>()
  const awaiting: string[] = []
  const unregister = (text: string): void => {
    const index = awaiting.indexOf(text)
    if (index >= 0) awaiting.splice(index, 1)
  }
  return {
    textFor(id) {
      const known = byId.get(id)
      if (known !== undefined) return known
      const claimed = awaiting.shift()
      if (claimed !== undefined) byId.set(id, claimed)
      return claimed
    },
    expect: (text) => void awaiting.push(text),
    cancel: unregister,
    bind(id, text) {
      if (byId.has(id)) return
      // No event named this submission (it ran at once): drop its unclaimed registration.
      unregister(text)
      byId.set(id, text)
    },
    forget: (id) => void byId.delete(id),
  }
}
