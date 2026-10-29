import { createOpenPiExtensionUIContext } from './extensionUiContext'
import { send, outputLine } from './sidecarContext'
import { isStaleExtensionCtxMessage } from './staleCtx'
import type { AgentSession } from '@earendil-works/pi-coding-agent'

/**
 * Wire an SDK session's extensions to the sidecar: their events and UI requests go over IPC, and a
 * failing bind is reported rather than thrown — a session without extensions still works.
 */
export async function bindSessionExtensions(session: AgentSession): Promise<void> {
  const extensionUiSinks = {
    sessionEvent: (event: Record<string, unknown>) => {
      send({ type: 'session_event', event })
    },
    postExtensionUiRequest: (
      request: import('../../src/lib/extensionUiTypes').ExtensionUiRequest
    ) => {
      send({ type: 'extension_ui_request', request })
    },
  }
  try {
    await session.bindExtensions({
      uiContext: createOpenPiExtensionUIContext(extensionUiSinks),
      mode: 'rpc',
      commandContextActions: {
        waitForIdle: () => session.agent.waitForIdle(),
        newSession: async () => ({ cancelled: true }),
        fork: async () => ({ cancelled: true }),
        navigateTree: async () => ({ cancelled: true }),
        switchSession: async () => ({ cancelled: true }),
        reload: async () => {
          await session.reload()
        },
      },
      onError: (err) => {
        // Suppress the benign "stale extension ctx" errors from pi-task. Its background polling
        // captures `pi`; when a session replacement invalidates that ctx, in-flight work briefly
        // calls into the stale one. The new session is already running, so this is noise.
        if (isStaleExtensionCtxMessage(err.error)) return
        outputLine('error', `[extension] ${err.extensionPath} (${err.event}): ${err.error}`)
      },
    })
  } catch (err) {
    outputLine(
      'error',
      `[openpi] bindExtensions failed: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}
