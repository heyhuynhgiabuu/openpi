/** Text handling for the commands a durable session accepts. */

/** Slash commands are refused; the context prefix is applied the way the SDK path does. */
export function promptText(cmd: { text: string; contextPrefix?: string }): string {
  const text = cmd.text.trim()
  if (text.startsWith('/')) {
    throw new Error('slash commands are not supported on the durable runtime yet')
  }
  const prefix = cmd.contextPrefix?.trim()
  return prefix ? `${prefix}\n\n${text}` : text
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
