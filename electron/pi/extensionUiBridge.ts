export type ExtensionNotifyLevel = 'info' | 'warn' | 'error'

import type { ExtensionUiRequest } from '../../src/lib/extensionUiTypes'

export type ExtensionUiBridgeSinks = {
  sessionEvent: (event: Record<string, unknown>) => void
  postExtensionUiRequest: (request: ExtensionUiRequest) => void
}

/** Mirror Pi TUI notify in the conversation stream. */
export function emitExtensionNotify(
  sinks: ExtensionUiBridgeSinks,
  level: ExtensionNotifyLevel,
  text: string
): void {
  const trimmed = text.trim()
  if (!trimmed) return

  const ts = Date.now()
  sinks.sessionEvent({
    type: 'message_start',
    message: {
      role: 'custom',
      customType: 'openpi-extension-notify',
      content: trimmed,
      display: true,
      details: { level },
      timestamp: ts,
    },
  })
  sinks.sessionEvent({
    type: 'message_end',
    message: {
      role: 'custom',
      customType: 'openpi-extension-notify',
      content: trimmed,
      display: true,
      details: { level },
      timestamp: ts,
    },
  })
}

export function extensionNotifyLevelFromPi(
  type?: 'info' | 'warning' | 'error'
): ExtensionNotifyLevel {
  if (type === 'error') return 'error'
  if (type === 'warning') return 'warn'
  return 'info'
}
