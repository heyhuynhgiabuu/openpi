export function formatSlashCommandInput(commandName: string): string {
  const trimmed = commandName.trim()
  const slashName = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return `${slashName} `
}

export function truncate(s: string, max = 36): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}

// Thinking levels supported by Pi — matches ThinkingLevel union in Pi SDK
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const
