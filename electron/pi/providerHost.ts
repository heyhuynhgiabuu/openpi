import fs from 'node:fs'
import path from 'node:path'
import { ipcMain } from 'electron'
import type { ModelInfo } from '../../src/lib/ipc'
import {
  type CustomProviderInfo,
  customProviderSchema,
  IPC,
  loginProviderSchema,
  logoutProviderSchema,
  type ProviderInfo,
  removeCustomProviderSchema,
  removeProviderKeySchema,
  resolveProviderPromptSchema,
  setModelSchema,
  setProviderKeySchema,
  setThinkingSchema,
} from '../../src/lib/ipc'
import { getAgentDir } from '../services/shellEnv'
import {
  createRequestId,
  getPiSidecarHost,
  getSessionState,
  requirePiSidecar,
} from '../session/sessionHost'
import type { SidecarMessage } from './sidecar'

// ─── Types ─────────────────────────────────────────────────────────────────────

type ModelsJsonProviderEntry = {
  name?: string
  baseUrl?: string
  api?: string
  apiKey?: string
  models?: Array<{ id: string; name?: string }>
  headers?: Record<string, string>
}

type ModelsJson = {
  providers?: Record<string, ModelsJsonProviderEntry>
}

// ─── Models.json helpers ───────────────────────────────────────────────────────

function readModelsJson(agentDir: string): ModelsJson {
  const modelsPath = path.join(agentDir, 'models.json')
  try {
    return JSON.parse(fs.readFileSync(modelsPath, 'utf-8')) as ModelsJson
  } catch {
    return {}
  }
}

function writeModelsJson(agentDir: string, data: ModelsJson): void {
  const modelsPath = path.join(agentDir, 'models.json')
  fs.mkdirSync(agentDir, { recursive: true })
  fs.writeFileSync(modelsPath, JSON.stringify(data, null, 2), 'utf-8')
}

// ─── Handler registration ──────────────────────────────────────────────────────

export function registerProviderHandlers(): void {
  // ── Model (sidecar-hosted) ──────────────────────────────────────────────────
  ipcMain.handle(IPC.GET_MODELS, async (): Promise<ModelInfo[]> => {
    const requestId = createRequestId()
    const response = await requirePiSidecar().request<
      Extract<SidecarMessage, { type: 'models_result' }>
    >({
      type: 'get_models',
      requestId,
    })
    return response.models as ModelInfo[]
  })

  ipcMain.handle(IPC.SET_MODEL, async (_event, raw: unknown) => {
    if (!getSessionState()) return
    const { provider, modelId } = setModelSchema.parse(raw)
    requirePiSidecar().send({ type: 'set_model', provider, modelId })
  })

  ipcMain.handle(IPC.SET_THINKING, async (_event, raw: unknown) => {
    if (!getSessionState()) return
    const { level } = setThinkingSchema.parse(raw)
    requirePiSidecar().send({ type: 'set_thinking', level })
  })

  // ── Provider (sidecar-hosted) ───────────────────────────────────────────────
  ipcMain.handle(IPC.GET_PROVIDERS, async (): Promise<ProviderInfo[]> => {
    const requestId = createRequestId()
    const response = await requirePiSidecar().request<
      Extract<SidecarMessage, { type: 'providers_result' }>
    >({
      type: 'get_providers',
      requestId,
    })
    return response.providers as ProviderInfo[]
  })

  ipcMain.handle(IPC.SET_PROVIDER_KEY, async (_event, raw: unknown): Promise<void> => {
    const { provider, apiKey } = setProviderKeySchema.parse(raw)
    requirePiSidecar().send({ type: 'set_provider_key', provider, apiKey })
  })

  ipcMain.handle(IPC.REMOVE_PROVIDER_KEY, async (_event, raw: unknown): Promise<void> => {
    const { provider } = removeProviderKeySchema.parse(raw)
    requirePiSidecar().send({ type: 'remove_provider_key', provider })
  })

  // ── OAuth subscription login ───────────────────────────────────────────────
  ipcMain.handle(IPC.LOGIN_PROVIDER, async (_event, raw: unknown): Promise<void> => {
    const { providerId } = loginProviderSchema.parse(raw)
    const requestId = createRequestId()
    requirePiSidecar().send({ type: 'login_provider', requestId, providerId })
  })

  ipcMain.handle(IPC.LOGOUT_PROVIDER, async (_event, raw: unknown): Promise<void> => {
    const { providerId } = logoutProviderSchema.parse(raw)
    requirePiSidecar().send({ type: 'logout_provider', providerId })
  })

  ipcMain.handle(IPC.RESOLVE_PROVIDER_PROMPT, (_event, raw: unknown): void => {
    const { providerId, value } = resolveProviderPromptSchema.parse(raw)
    requirePiSidecar().send({ type: 'resolve_provider_prompt', providerId, value })
  })

  // ── Custom provider (models.json) ──────────────────────────────────────────
  ipcMain.handle(IPC.GET_CUSTOM_PROVIDERS, (): CustomProviderInfo[] => {
    const agentDir = getAgentDir()
    const { providers = {} } = readModelsJson(agentDir)
    return Object.entries(providers).map(([id, cfg]) => ({
      id,
      name: cfg.name ?? id,
      baseUrl: cfg.baseUrl ?? '',
      modelCount: Array.isArray(cfg.models) ? cfg.models.length : 0,
      hasApiKey: Boolean(cfg.apiKey),
    }))
  })

  ipcMain.handle(IPC.ADD_CUSTOM_PROVIDER, (_event, raw: unknown): void => {
    const provider = customProviderSchema.parse(raw)
    const agentDir = getAgentDir()
    const modelsJson = readModelsJson(agentDir)

    const entry: ModelsJsonProviderEntry = {
      baseUrl: provider.baseUrl,
      api: 'openai-completions',
      models: provider.models.map((m) => (m.name ? { id: m.id, name: m.name } : { id: m.id })),
    }
    if (provider.name) entry.name = provider.name
    if (provider.apiKey) entry.apiKey = provider.apiKey
    if (provider.headers && Object.keys(provider.headers).length > 0) {
      entry.headers = provider.headers
    }

    modelsJson.providers ??= {}
    modelsJson.providers[provider.id] = entry
    writeModelsJson(agentDir, modelsJson)

    getPiSidecarHost()?.send({ type: 'invalidate_models' })
  })

  ipcMain.handle(IPC.REMOVE_CUSTOM_PROVIDER, (_event, raw: unknown): void => {
    const { id } = removeCustomProviderSchema.parse(raw)
    const agentDir = getAgentDir()
    const modelsJson = readModelsJson(agentDir)
    if (modelsJson.providers) {
      delete modelsJson.providers[id]
    }
    writeModelsJson(agentDir, modelsJson)
    getPiSidecarHost()?.send({ type: 'invalidate_models' })
  })
}
