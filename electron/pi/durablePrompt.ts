/**
 * Text handling for the commands a durable session accepts.
 *
 * A `/template args` prompt is expanded by the harness (`expandInput`), which is what the SDK path
 * does before the message reaches the model — the composer clears the input on send, so refusing
 * the text here would lose what the user typed. An unknown `/name` reaches the model unchanged, as
 * on the SDK path; extension slash commands are advertised by `list_slash_commands` and expanded by
 * the same pass when they are templates.
 */
export function promptText(
  cmd: { text: string; contextPrefix?: string },
  expand: (text: string) => string = (text) => text
): string {
  // The template expander only recognises a `/` at the very start, so the user's text is expanded
  // first and the context prefix is joined afterwards. A `/name` that no template, skill or
  // extension command answers is refused, as the SDK path refuses it: sending the literal text
  // would silently do nothing the user asked for.
  const text = expand(cmd.text.trim())
  if (text.startsWith('/')) {
    throw new Error(`unknown command: ${text.split(' ')[0]}`)
  }
  const prefix = cmd.contextPrefix?.trim()
  return prefix ? `${prefix}\n\n${text}` : text
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
