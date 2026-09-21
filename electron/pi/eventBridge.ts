/**
 * Bridges the active session's event stream to the parent process: every
 * event is forwarded as a session_event message; a few kinds are additionally
 * mirrored into the output log or trigger index refreshes.
 */

import type { AgentSessionEvent, createAgentSession } from '@earendil-works/pi-coding-agent'
import { isStaleExtensionCtxEvent } from './staleCtx'
import { outputLine, send } from './sidecarContext'

type Session = Awaited<ReturnType<typeof createAgentSession>>['session']

export function isSessionIndexUpdateEvent(type: string): boolean {
  return type === 'agent_end' || type === 'entry_appended'
}

export function forwardSessionEvents(session: Session, onIndexUpdate: () => void): () => void {
  return session.subscribe((event: AgentSessionEvent) => {
    if (isStaleExtensionCtxEvent(event)) return

    send({ type: 'session_event', event: event as Record<string, unknown> })

    const ev = event as {
      type: string
      success?: boolean
      finalError?: string
      errorMessage?: string
      message?: string
    }

    if (isSessionIndexUpdateEvent(ev.type)) {
      onIndexUpdate()
    }

    if (ev.type === 'extension_error') {
      const extErr = ev as { extensionPath?: string; event?: string; error?: string }
      outputLine(
        'error',
        `[extension] ${extErr.extensionPath ?? 'unknown'} (${extErr.event ?? 'error'}): ${extErr.error ?? 'extension error'}`
      )
    }

    if (ev.type === 'auto_retry_end' && ev.success === false) {
      outputLine('warn', `[retry] ${ev.finalError ?? 'Auto-retry failed'}`)
    }

    if (ev.type === 'compaction_end' && ev.errorMessage) {
      outputLine('error', `[compaction] ${ev.errorMessage}`)
    }
  })
}
