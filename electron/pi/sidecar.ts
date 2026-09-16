/**
 * piSidecar.ts — Pi SDK agent runtime running in a sidecar child process.
 *
 * Isolates all Pi SDK memory from the main process. Main stays ≤100 MB;
 * Pi SDK (sessions, models, resource loading) lives here and can grow freely.
 *
 * Communication: typed JSON messages over process.parentPort.
 * All heavy imports (Pi SDK, resource loader) happen inside this directory
 * only. This entry keeps the protocol wiring (port, validation, queue) and
 * the exhaustive command dispatch; handlers live in the sibling modules:
 *
 *   sidecarContext.ts        shared state: port, session, model runtime, loader
 *   slashPrompt.ts           slash-command recognition + prompt expansion
 *   eventBridge.ts           session event stream → parent forwarding
 *   sessionLifecycle.ts      start/stop session transitions
 *   conversationCommands.ts  prompt/steer/abort/bash/model/thinking
 *   sessionInfoCommands.ts   info/stats/compact/copy/name
 *   sessionFlowCommands.ts   start/reload/fork/navigate/stop
 *   providerCommands.ts      models/settings/trust/providers/login
 */

import { createSidecarCommandQueue } from './sidecarCommandQueue'
import { sidecarCommandSchema } from './sidecarContracts'
import { handleResourceCommand, isResourceCommand } from './resourceCommands'
import type { SessionReadyPayload, SidecarCommand, SidecarMessage } from './sidecarTypes'
import { getResourceLoader, getState, onParentMessage, send } from './sidecarContext'
import { handleAbortCommand } from './conversationCommands'
import {
  handleCompactCommand,
  handleCopyLastAssistantTextCommand,
  handleGetSessionInfoCommand,
  handleGetStatsCommand,
  handleSetSessionNameCommand,
} from './sessionInfoCommands'
import {
  handleForkSessionCommand,
  handleNavigateTreeCommand,
  handleReloadSessionCommand,
  handleStartSessionCommand,
  handleStopCommand,
} from './sessionFlowCommands'
import {
  handleExtensionUiResponseCommand,
  handleGetDefaultProjectTrustCommand,
  handleGetModelsCommand,
  handleGetProvidersCommand,
  handleGetSettingsCommand,
  handleInvalidateModelsCommand,
  handleLoginProviderCommand,
  handleLogoutProviderCommand,
  handleRemoveProviderKeyCommand,
  handleResolveProviderPromptCommand,
  handleSaveSettingsCommand,
  handleSetDefaultProjectTrustCommand,
  handleSetProviderKeyCommand,
} from './providerCommands'
import {
  handleExecuteBashCommand,
  handleFollowUpCommand,
  handlePromptCommand,
  handleSetModelCommand,
  handleSetThinkingCommand,
  handleSteerCommand,
} from './conversationCommands'

export type { SessionReadyPayload, SidecarCommand, SidecarMessage }

// Supply-chain hardening runs via the sidecarEnv import inside sidecarContext
// (evaluated before every other sidecar module side effect).

async function handleCommand(cmd: SidecarCommand): Promise<void> {
  if (isResourceCommand(cmd)) {
    await handleResourceCommand(cmd, {
      getCwd: () => getState()?.cwd ?? null,
      getSession: () => getState()?.session ?? null,
      getResourceLoader,
      send,
    })
    return
  }

  switch (cmd.type) {
    case 'start_session':
      return handleStartSessionCommand(cmd)
    case 'prompt':
      return handlePromptCommand(cmd)
    case 'steer':
      return handleSteerCommand(cmd)
    case 'follow_up':
      return handleFollowUpCommand(cmd)
    case 'abort':
      return handleAbortCommand(cmd)
    case 'execute_bash':
      return handleExecuteBashCommand(cmd)
    case 'set_model':
      return handleSetModelCommand(cmd)
    case 'set_thinking':
      return handleSetThinkingCommand(cmd)
    case 'set_session_name':
      return handleSetSessionNameCommand(cmd)
    case 'get_session_info':
      return handleGetSessionInfoCommand(cmd)
    case 'compact':
      return handleCompactCommand(cmd)
    case 'reload_session':
      return handleReloadSessionCommand(cmd)
    case 'copy_last_assistant_text':
      return handleCopyLastAssistantTextCommand(cmd)
    case 'fork_session':
      return handleForkSessionCommand(cmd)
    case 'navigate_tree':
      return handleNavigateTreeCommand(cmd)
    case 'get_stats':
      return handleGetStatsCommand(cmd)
    case 'get_models':
      return handleGetModelsCommand(cmd)
    case 'get_settings':
      return handleGetSettingsCommand(cmd)
    case 'save_settings':
      return handleSaveSettingsCommand(cmd)
    case 'get_default_project_trust':
      return handleGetDefaultProjectTrustCommand(cmd)
    case 'set_default_project_trust':
      return handleSetDefaultProjectTrustCommand(cmd)
    case 'get_providers':
      return handleGetProvidersCommand(cmd)
    case 'set_provider_key':
      return handleSetProviderKeyCommand(cmd)
    case 'remove_provider_key':
      return handleRemoveProviderKeyCommand(cmd)
    case 'invalidate_models':
      return handleInvalidateModelsCommand(cmd)
    case 'login_provider':
      return handleLoginProviderCommand(cmd)
    case 'logout_provider':
      return handleLogoutProviderCommand(cmd)
    case 'resolve_provider_prompt':
      return handleResolveProviderPromptCommand(cmd)
    case 'extension_ui_response':
      return handleExtensionUiResponseCommand(cmd)
    case 'stop':
      return handleStopCommand(cmd)
    default: {
      // Compile-time exhaustiveness: every SidecarCommand variant must be
      // dispatched above; a new variant fails to compile here.
      const _exhaustive: never = cmd
      return _exhaustive
    }
  }
}

const queueCommand = createSidecarCommandQueue(handleCommand)

onParentMessage((message) => {
  const rawCommand =
    message && typeof message === 'object' && 'data' in message ? message.data : message
  const parsedCommand = sidecarCommandSchema.safeParse(rawCommand)
  if (!parsedCommand.success) {
    const requestId =
      rawCommand &&
      typeof rawCommand === 'object' &&
      'requestId' in rawCommand &&
      typeof rawCommand.requestId === 'string'
        ? rawCommand.requestId
        : undefined
    send({ type: 'error', requestId, message: 'Invalid sidecar command' })
    return
  }
  const cmd: SidecarCommand = parsedCommand.data
  void queueCommand(cmd).catch((err) => {
    send({
      type: 'error',
      requestId: 'requestId' in cmd ? cmd.requestId : undefined,
      message: err instanceof Error ? err.message : String(err),
    })
  })
})

// ─── Boot ──────────────────────────────────────────────────────────────────────

send({ type: 'ready' })
