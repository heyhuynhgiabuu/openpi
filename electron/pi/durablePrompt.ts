/**
 * Text handling for the commands a durable session accepts.
 *
 * A `/template args` prompt is expanded by the harness (`expandInput`), which is what the SDK path
 * does before the message reaches the model — the composer clears the input on send, so refusing
 * the text here would lose what the user typed. An unknown `/name` reaches the model unchanged, as
 * on the SDK path; extension slash commands are advertised by `list_slash_commands` and expanded by
 * the same pass when they are templates.
 */
export function promptText(cmd: { text: string; contextPrefix?: string }): string {
  const text = cmd.text.trim()
  const prefix = cmd.contextPrefix?.trim()
  return prefix ? `${prefix}\n\n${text}` : text
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
