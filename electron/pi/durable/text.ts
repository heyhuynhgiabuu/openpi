import type { Message } from '@earendil-works/pi-ai'

/** Content parts carry a `type`; only `text` parts contribute to the adapter's text snapshot. */
function isTextPart(part: unknown): part is { type: 'text'; text: string } {
  if (typeof part !== 'object' || part === null) return false
  const candidate = part as { type?: unknown; text?: unknown }
  return candidate.type === 'text' && typeof candidate.text === 'string'
}

/** Message content is either a plain string or an array of parts; anything else contributes no text. */
export function messageText(message: Message | undefined): string | undefined {
  if (message === undefined) return undefined
  const content: unknown = message.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return undefined
  return content
    .filter(isTextPart)
    .map((part) => part.text)
    .join('')
}
