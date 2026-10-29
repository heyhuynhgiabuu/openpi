/**
 * Text handling for the commands a durable session accepts.
 *
 * A `/template args` prompt is expanded by the harness (`expandInput`), which is what the SDK path
 * does before the message reaches the model. `prompt` alone refuses a `/name` nothing answers, as
 * the SDK refuses it; steer and follow-up pass their text through unmapped, also as the SDK does.
 */
export interface PromptTextResult {
  /** The text to send, prefix included. */
  text: string
  /** Set when a `/name` nothing answers should be refused instead of sent. */
  unknownCommand?: string
}

export function promptText(
  cmd: { text: string; contextPrefix?: string },
  expand: (text: string) => string = (text) => text,
  kind: 'prompt' | 'queue' = 'prompt'
): PromptTextResult {
  // The expander only recognises a `/` at the very start, so the user's text is expanded before the
  // context prefix is joined — otherwise the prefix defeats it. An unknown `/name` is detected on
  // the user's own text, before expansion, so a template body starting with `/` is not mistaken
  // for one.
  const raw = cmd.text.trim()
  const text = expand(raw)
  const unknownCommand = kind === 'prompt' ? unansweredCommand(raw, text) : undefined
  const prefix = cmd.contextPrefix?.trim()
  const joined = prefix ? `${prefix}\n\n${text}` : text
  return unknownCommand ? { text: joined, unknownCommand } : { text: joined }
}

/** The `/name` typed, when the expander left the text untouched — i.e. nothing answered it. */
function unansweredCommand(raw: string, expanded: string): string | undefined {
  if (!raw.startsWith('/') || expanded !== raw) return undefined
  return raw.split(' ')[0]
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
