/**
 * Conversation-flow sidecar commands: prompting, steering, follow-up,
 * aborting, bash execution, model and thinking-level selection. Pure move of
 * the corresponding cases from sidecar.ts's command switch.
 */

import type { SidecarCommand } from './sidecarTypes'
import { getModelRuntime, getState, send } from './sidecarContext'
import {
  buildSidecarPromptText,
  isKnownSessionSlashCommand,
  sendUnsupportedSlashCommand,
  slashInvocationName,
} from './slashPrompt'

export async function handlePromptCommand(
  cmd: Extract<SidecarCommand, { type: 'prompt' }>
): Promise<void> {
  const state = getState()
  if (!state) return
  const trimmed = cmd.text.trim()
  const invocationName = slashInvocationName(trimmed)
  if (invocationName) {
    if (!isKnownSessionSlashCommand(state.session, invocationName)) {
      sendUnsupportedSlashCommand(invocationName)
      return
    }
    await state.session.prompt(trimmed)
  } else {
    const promptText = buildSidecarPromptText(cmd.text, cmd.contextPrefix, state.session)
    await state.session.prompt(promptText)
  }
}

export async function handleSteerCommand(
  cmd: Extract<SidecarCommand, { type: 'steer' }>
): Promise<void> {
  const state = getState()
  if (!state) return
  const steerText = buildSidecarPromptText(cmd.text, cmd.contextPrefix, state.session)
  await state.session.steer(steerText)
}

export async function handleFollowUpCommand(
  cmd: Extract<SidecarCommand, { type: 'follow_up' }>
): Promise<void> {
  const state = getState()
  if (!state) return
  const followUpText = buildSidecarPromptText(cmd.text, cmd.contextPrefix, state.session)
  await state.session.followUp(followUpText)
}

export async function handleAbortCommand(
  _cmd: Extract<SidecarCommand, { type: 'abort' }>
): Promise<void> {
  const state = getState()
  if (!state) return
  await state.session.abort()
}

export async function handleExecuteBashCommand(
  cmd: Extract<SidecarCommand, { type: 'execute_bash' }>
): Promise<void> {
  const state = getState()
  if (!state) {
    send({ type: 'bash_result', requestId: cmd.requestId, result: null })
    return
  }
  const result = await state.session.executeBash(cmd.command, undefined, {
    excludeFromContext: cmd.excludeFromContext,
  })
  send({ type: 'bash_result', requestId: cmd.requestId, result })
}

export async function handleSetModelCommand(
  cmd: Extract<SidecarCommand, { type: 'set_model' }>
): Promise<void> {
  const state = getState()
  if (!state) return
  const model = (await getModelRuntime()).getModel(cmd.provider, cmd.modelId)
  if (!model) return
  // Pi 0.85.0 changed setModel/setThinkingLevel to be session-scoped by
  // default (persist only with an explicit option). OpenPi's model selector
  // has always saved the global default, so pass persist: true to keep that
  // behavior instead of silently regressing the user's saved model.
  await state.session.setModel(model, { persist: true })
}

export async function handleSetThinkingCommand(
  cmd: Extract<SidecarCommand, { type: 'set_thinking' }>
): Promise<void> {
  const state = getState()
  if (!state) return
  state.session.setThinkingLevel(
    cmd.level as Parameters<typeof state.session.setThinkingLevel>[0],
    { persist: true }
  )
}
