import { join } from 'node:path'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { openDurableHarness } from './durable/harness'
import {
  createDurableSessions,
  type DurableIdentity,
  type DurableOpenResult,
} from './durableSession'
import { createSessionSettingsManager } from './sessionSettings'
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
  const provider = settings.getDefaultProvider()
  const modelId = settings.getDefaultModel()
  if (!provider || !modelId) {
    throw new Error('the durable runtime needs a default model; choose one in settings')
  }
  const model = modelRuntime.getModel(provider, modelId)
  if (!model) throw new Error(`default model ${provider}/${modelId} is not available`)

  const harness = await openDurableHarness({
    backend: 'jsonl',
    directory: join(agentDir, 'durable', identity.sessionId),
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
    model: {
      id: model.id,
      name: model.name,
      provider: model.provider,
      reasoning: model.reasoning ?? false,
      contextWindow: model.contextWindow ?? 0,
    },
  }
}

export const durableSessions = createDurableSessions({
  send,
  log: outputLine,
  newIdentity,
  open,
  now: () => new Date(),
})
