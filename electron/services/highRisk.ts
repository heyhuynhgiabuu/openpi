/**
 * High-risk shell command detection. Pure on purpose: the Pi sidecar and the durable runtime's
 * policy gate import it, and neither runs inside Electron's main process, so this module must not
 * import `electron` (`shellEnv.ts` does, for `app`).
 */

export const HIGH_RISK_COMMAND_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\brm\s+(-[^\s]*[rf][^\s]*|--recursive|--force)/,
    reason: 'recursive/forced file deletion',
  },
  { pattern: /\bgit\s+reset\s+--hard\b/, reason: 'Git hard reset discards local changes' },
  { pattern: /\bgit\s+clean\s+-[^\s]*[fd]/, reason: 'Git clean deletes untracked files' },
  {
    pattern: /\bgit\s+push\b[^\n]*\s(--force|-f|--force-with-lease)\b/,
    reason: 'force-push rewrites remote history',
  },
  { pattern: /\bgit\s+rebase\s+--abort\b/, reason: 'rebase abort rewrites the working tree state' },
  {
    pattern: /\b(?:sudo\s+)?(?:dd|mkfs|diskutil|fdisk)\b/,
    reason: 'disk-level command can destroy data',
  },
  { pattern: /\bchmod\s+-R\s+777\b/, reason: 'recursive world-writable permission change' },
  { pattern: /\bchown\s+-R\b/, reason: 'recursive ownership change' },
]

export function highRiskShellReason(command: string): string | null {
  const normalized = command.replace(/\\\n/g, '\n')
  for (const { pattern, reason } of HIGH_RISK_COMMAND_PATTERNS) {
    if (pattern.test(normalized)) return reason
  }
  return null
}
