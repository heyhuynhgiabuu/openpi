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

const SUMMARY_OPEN = '<summary>'
const SUMMARY_CLOSE = '</summary>'

/** True for the user message pi-durable writes for a compaction: "…compacted into…\n\n<summary>…". */
export function isSummaryWrapped(text: string | undefined): boolean {
  return (
    text !== undefined &&
    text.startsWith('The conversation history before this point was compacted') &&
    text.includes(SUMMARY_OPEN)
  )
}

/**
 * The raw summary inside pi-durable's wrapper `…<summary>\n{summary}\n</summary>`. Strips only the
 * outer pair (first open, last close): the summary may itself quote either tag.
 */
export function unwrapSummary(text: string): string {
  const open = text.indexOf(SUMMARY_OPEN)
  const close = text.lastIndexOf(SUMMARY_CLOSE)
  if (open === -1 || close < open) return text
  return text.slice(open + SUMMARY_OPEN.length, close).trim()
}
