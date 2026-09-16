/**
 * Configuration sidecar commands: models, settings, project trust, provider
 * credentials and OAuth login, and extension UI responses. Pure move of the
 * corresponding cases from sidecar.ts's command switch.
 */

import fs from 'node:fs'
import path from 'node:path'
import { SettingsManager } from '@earendil-works/pi-coding-agent'
import { fulfillExtensionUiPending } from './extensionUiPending'
import { answerApiKeyPrompt, providerLoginFailureEvent } from './providerAuth'
import type { SidecarCommand } from './sidecarTypes'
import {
  clearResourceLoaderCache,
  getAgentDir,
  getModelRuntime,
  getState,
  invalidateModelRuntime,
  providerAuthBridge,
  send,
} from './sidecarContext'

export async function handleGetModelsCommand(
  cmd: Extract<SidecarCommand, { type: 'get_models' }>
): Promise<void> {
  const models = await (await getModelRuntime()).getAvailable()
  const mapped = models.map((model) => ({
    id: model.id,
    name: model.name,
    provider: model.provider,
    reasoning: model.reasoning ?? false,
    contextWindow: model.contextWindow ?? 0,
  }))
  send({ type: 'models_result', requestId: cmd.requestId, models: mapped })
}

export async function handleGetSettingsCommand(
  cmd: Extract<SidecarCommand, { type: 'get_settings' }>
): Promise<void> {
  const state = getState()
  const agentDir = getAgentDir()
  const settingsManager = state
    ? SettingsManager.create(state.cwd, agentDir)
    : SettingsManager.create(agentDir, agentDir)
  const global = settingsManager.getGlobalSettings()
  const project = state ? settingsManager.getProjectSettings() : {}
  const effective = { ...global, ...project }
  send({
    type: 'settings_result',
    requestId: cmd.requestId,
    result: { global, project, effective },
  })
}

export async function handleSaveSettingsCommand(
  cmd: Extract<SidecarCommand, { type: 'save_settings' }>
): Promise<void> {
  const state = getState()
  const agentDir = getAgentDir()
  const settingsPath =
    cmd.scope === 'global'
      ? path.join(agentDir, 'settings.json')
      : path.join(state?.cwd ?? agentDir, '.pi', 'settings.json')
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
  fs.writeFileSync(settingsPath, `${JSON.stringify(cmd.settings, null, 2)}\n`, 'utf-8')
  // Reload resource loader cache after settings change
  clearResourceLoaderCache()
}

export async function handleGetDefaultProjectTrustCommand(
  cmd: Extract<SidecarCommand, { type: 'get_default_project_trust' }>
): Promise<void> {
  const state = getState()
  if (!state) {
    send({
      type: 'default_project_trust_result',
      requestId: cmd.requestId,
      defaultProjectTrust: 'ask',
    })
    return
  }
  const agentDir = getAgentDir()
  const settingsManager = SettingsManager.create(state.cwd, agentDir)
  const value = settingsManager.getDefaultProjectTrust()
  send({
    type: 'default_project_trust_result',
    requestId: cmd.requestId,
    defaultProjectTrust: value,
  })
}

export async function handleSetDefaultProjectTrustCommand(
  cmd: Extract<SidecarCommand, { type: 'set_default_project_trust' }>
): Promise<void> {
  const state = getState()
  if (!state) return
  const agentDir = getAgentDir()
  const settingsManager = SettingsManager.create(state.cwd, agentDir)
  settingsManager.setDefaultProjectTrust(cmd.defaultProjectTrust)
}

export async function handleGetProvidersCommand(
  cmd: Extract<SidecarCommand, { type: 'get_providers' }>
): Promise<void> {
  const modelRuntime = await getModelRuntime()
  await modelRuntime.getAvailable()
  const credentialTypes = new Map(
    (await modelRuntime.listCredentials()).map(({ providerId, type }) => [providerId, type])
  )
  const providerModelCounts = new Map<string, number>()
  for (const model of modelRuntime.getModels()) {
    providerModelCounts.set(model.provider, (providerModelCounts.get(model.provider) ?? 0) + 1)
  }
  const providers = modelRuntime.getProviders().map((provider) => {
    const status = modelRuntime.getProviderAuthStatus(provider.id)
    const storedType = credentialTypes.get(provider.id)
    const credentialType = storedType
      ? storedType
      : status.source === 'environment'
        ? 'env'
        : status.configured
          ? 'other'
          : undefined
    const authMethods: Array<'api_key' | 'oauth'> = []
    if (provider.auth.apiKey?.login) authMethods.push('api_key')
    if (provider.auth.oauth) authMethods.push('oauth')
    return {
      id: provider.id,
      displayName: provider.name,
      configured: status.configured,
      modelCount: providerModelCounts.get(provider.id) ?? 0,
      source: status.source,
      credentialType,
      authMethods,
    }
  })
  send({ type: 'providers_result', requestId: cmd.requestId, providers })
}

export async function handleSetProviderKeyCommand(
  cmd: Extract<SidecarCommand, { type: 'set_provider_key' }>
): Promise<void> {
  const modelRuntime = await getModelRuntime()
  const promptState = { keyUsed: false }
  await modelRuntime.login(cmd.provider, 'api_key', {
    prompt: async (prompt) =>
      answerApiKeyPrompt({
        prompt,
        apiKey: cmd.apiKey,
        providerName: modelRuntime.getProvider(cmd.provider)?.name ?? cmd.provider,
        state: promptState,
      }),
    notify: () => {},
  })
  send({ type: 'provider_mutation_result', requestId: cmd.requestId })
}

export async function handleRemoveProviderKeyCommand(
  cmd: Extract<SidecarCommand, { type: 'remove_provider_key' }>
): Promise<void> {
  await (await getModelRuntime()).logout(cmd.provider)
  send({ type: 'provider_mutation_result', requestId: cmd.requestId })
}

export async function handleInvalidateModelsCommand(
  cmd: Extract<SidecarCommand, { type: 'invalidate_models' }>
): Promise<void> {
  await invalidateModelRuntime()
}

export async function handleLoginProviderCommand(
  cmd: Extract<SidecarCommand, { type: 'login_provider' }>
): Promise<void> {
  try {
    const modelRuntime = await getModelRuntime()
    await modelRuntime.login(
      cmd.providerId,
      'oauth',
      providerAuthBridge.createInteraction(cmd.requestId, cmd.providerId)
    )
    send({ type: 'provider_login_event', requestId: cmd.requestId, event: { type: 'success' } })
  } catch (err) {
    send({
      type: 'provider_login_event',
      requestId: cmd.requestId,
      event: providerLoginFailureEvent(err),
    })
  }
}

export async function handleLogoutProviderCommand(
  cmd: Extract<SidecarCommand, { type: 'logout_provider' }>
): Promise<void> {
  await (await getModelRuntime()).logout(cmd.providerId)
  send({ type: 'provider_mutation_result', requestId: cmd.requestId })
}

export async function handleResolveProviderPromptCommand(
  cmd: Extract<SidecarCommand, { type: 'resolve_provider_prompt' }>
): Promise<void> {
  providerAuthBridge.resolve(cmd.providerId, cmd.value)
}

export async function handleExtensionUiResponseCommand(
  cmd: Extract<SidecarCommand, { type: 'extension_ui_response' }>
): Promise<void> {
  fulfillExtensionUiPending({
    id: cmd.id,
    cancelled: cmd.cancelled,
    confirmed: cmd.confirmed,
    value: cmd.value,
    approved: cmd.approved,
    remember: cmd.remember,
  })
}
