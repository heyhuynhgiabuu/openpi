import type { ConversationId } from '@earendil-works/pi-durable'

/**
 * A conversation id read back from where this app stored it (a session's identity).
 *
 * pi-durable hands ids out as branded numbers and offers no way to rebuild one, but a session has
 * to remember which conversation of its store it is. The store itself still answers `undefined`
 * for an id it does not know, so a wrong number cannot reach another conversation's data.
 */
export function conversationIdOf(value: number): ConversationId {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`invalid conversation id: ${value}`)
  // SAFETY: a branded id is a plain number at runtime; the brand is compile-time only.
  return value as ConversationId
}
