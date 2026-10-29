import { join } from 'node:path'
import { getSupportedThinkingLevels, type Api, type Model } from '@earendil-works/pi-ai'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { openDurableHarness } from './durable/harness'
import { chooseDurableModel } from './durableModel'
import {
  createDurableSessions,
  type DurableIdentity,
  type DurableOpenResult,
} from './durableSession'
import type { ResolvedModel } from './durableSettings'
import { createSessionSettingsManager } from './sessionSettings'
import type { SessionReadyPayload } from './sidecarTypes'
import { getAgentDir, getModelRuntime, outputLine, send } from './sidecarContext'

/**
 * Production wiring for the durable session factory: the real model runtime, settings and session
 * directory. Kept apart from `durableSession.ts` because importing the sidecar context requires a
 * parent process, which tests do not have.
 */

function newIdentity(cwd: string): DurableIdentity {
  // `SessionManager.create` only computes the id and path (no file is written until the first
  // export), so the durable export lands exactly where the sidebar already looks.
  const manager = SessionManager.create(cwd)
  const sessionFile = manager.getSessionFile()
  if (!sessionFile) throw new Error('could not resolve a session file for the durable session')
  return { sessionId: manager.getSessionId(), sessionFile }
}

async function open(
  cwd: string,
  workspaceTrusted: boolean,
  identity: DurableIdentity
): Promise<DurableOpenResult> {
  const agentDir = getAgentDir()
  const modelRuntime = await getModelRuntime()
  const settings = createSessionSettingsManager(cwd, agentDir, workspaceTrusted)
  // The SDK path resolves a model itself (stored default, else the first with credentials); the
  // harness takes one explicitly, so the same choice is made here rather than refusing to start.
  const choice = chooseDurableModel(settings, modelRuntime)
  if (!choice) throw new Error('no model has credentials; sign in to one in settings')
  const { provider, modelId } = choice
  const model = modelRuntime.getModel(provider, modelId)
  if (!model) throw new Error(`default model ${provider}/${modelId} is not available`)

  const harness = await openDurableHarness({
    backend: 'jsonl',
    directory: join(agentDir, 'durable', identity.storeId ?? identity.sessionId),
    // Resuming must fail loudly when the store is gone: the jsonl backend creates an empty
    // directory, and the export after it would then replace the session's history with nothing.
    requireStore: identity.storeId !== undefined,
    conversationIds: identity.conversationIds,
    model: { provider, modelId },
    // The SDK's model runtime implements `Models`: auth.json, models.json and OAuth are shared.
    models: modelRuntime,
    userAgentDir: agentDir,
    workspacePath: cwd,
    projectTrusted: workspaceTrusted,
    mcp: true,
  })
  return {
    harness,
    model: modelInfo(model),
    thinkingLevels: getSupportedThinkingLevels(model),
    persist: {
      model: (p, m) => settings.setDefaultModelAndProvider(p, m),
      thinking: (level) => settings.setDefaultThinkingLevel(level),
    },
  }
}

async function resolveModel(provider: string, modelId: string): Promise<ResolvedModel | undefined> {
  const model = (await getModelRuntime()).getModel(provider, modelId)
  if (!model) return undefined
  return { info: modelInfo(model), thinkingLevels: getSupportedThinkingLevels(model) }
}

function modelInfo(model: Model<Api>): NonNullable<SessionReadyPayload['model']> {
  return {
    id: model.id,
    name: model.name,
    provider: model.provider,
    reasoning: model.reasoning ?? false,
    contextWindow: model.contextWindow ?? 0,
  }
}

export const durableSessions = createDurableSessions({
  send,
  log: outputLine,
  newIdentity,
  open,
  resolveModel,
  now: () => new Date(),
})
