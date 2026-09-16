/**
 * Sidecar shared runtime context: the parent port, the singleton session
 * state, the model runtime, and the cached resource loader. Everything else
 * in the sidecar depends on this module; it depends on nothing local.
 */

import os from 'node:os'
import path from 'node:path'
import './sidecarEnv'
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import { ProviderAuthBridge } from './providerAuth'
import type { SidecarMessage } from './sidecarTypes'

export type SessionState = {
  session: Awaited<ReturnType<typeof createAgentSession>>['session']
  cwd: string
  workspaceTrusted: boolean
  unsubscribe: () => void
}

// ─── Port ─────────────────────────────────────────────────────────────────────

type ParentPort = {
  postMessage(msg: unknown): void
  on(event: 'message', listener: (message: unknown) => void): void
}

function createParentPort(): ParentPort | null {
  const electronParentPort = (process as unknown as { parentPort?: ParentPort }).parentPort
  if (electronParentPort) return electronParentPort

  if (typeof process.send !== 'function') return null
  return {
    postMessage(msg: unknown): void {
      process.send?.(msg)
    },
    on(_event: 'message', listener: (message: unknown) => void): void {
      process.on('message', listener)
    },
  }
}

const maybeParentPort = createParentPort()
if (!maybeParentPort) {
  process.stderr.write('[piSidecar] No parent port — must run as utilityProcess or Node fork\n')
  process.exit(1)
}
const parentPort: ParentPort = maybeParentPort

export function send(msg: SidecarMessage): void {
  parentPort.postMessage(msg)
}

export function onParentMessage(listener: (message: unknown) => void): void {
  parentPort.on('message', listener)
}

export function outputLine(level: 'info' | 'warn' | 'error', text: string): void {
  send({ type: 'output_append', line: { level, text, ts: Date.now() } })
}

// ─── Session state ─────────────────────────────────────────────────────────────

let state: SessionState | null = null

export function getState(): SessionState | null {
  return state
}

export function setState(next: SessionState | null): void {
  state = next
}

// ─── Model runtime ─────────────────────────────────────────────────────────────

export function getAgentDir(): string {
  return path.join(os.homedir(), '.pi', 'agent')
}

let _modelRuntimePromise: Promise<ModelRuntime> | null = null

export function getModelRuntime(): Promise<ModelRuntime> {
  const agentDir = getAgentDir()
  _modelRuntimePromise ??= ModelRuntime.create({
    authPath: path.join(agentDir, 'auth.json'),
    modelsPath: path.join(agentDir, 'models.json'),
  })
  return _modelRuntimePromise
}

export async function invalidateModelRuntime(): Promise<void> {
  if (!_modelRuntimePromise) return
  const modelRuntime = await _modelRuntimePromise
  // Refresh the existing runtime so extension-registered providers are preserved.
  await modelRuntime.refresh({ allowNetwork: false })
}

export const providerAuthBridge = new ProviderAuthBridge((requestId, event) => {
  send({ type: 'provider_login_event', requestId, event })
})

// ─── Resource loader ────────────────────────────────────────────────────────────

let _cachedResourceLoader: {
  cwd: string
  workspaceTrusted: boolean
  loader: InstanceType<typeof DefaultResourceLoader>
} | null = null

export function clearResourceLoaderCache(): void {
  _cachedResourceLoader = null
}

export async function getResourceLoader(cwd: string, workspaceTrusted: boolean) {
  const agentDir = getAgentDir()
  if (
    _cachedResourceLoader &&
    _cachedResourceLoader.cwd === cwd &&
    _cachedResourceLoader.workspaceTrusted === workspaceTrusted
  ) {
    return _cachedResourceLoader.loader
  }

  const fileSettingsManager = SettingsManager.create(cwd, agentDir)
  const settingsManager = workspaceTrusted
    ? fileSettingsManager
    : SettingsManager.inMemory(fileSettingsManager.getGlobalSettings())
  // When the workspace is not yet trusted, project-local extensions (.pi/extensions)
  // are blocked by noExtensions=true — they're unknown third-party code.
  // Global extensions (~/.pi/agent/extensions) are the user's own trusted code and
  // MUST always load regardless of workspace trust (e.g. copilot-provider.ts registers
  // the github-copilot provider; blocking it causes "No API key found" errors).
  //
  // We pass agentDir (not agentDir/extensions) as the additional path. The SDK's
  // collectPackageResources treats the path as a "package root" and scans for an
  // extensions/ subdirectory inside it — exactly what we need. If we passed
  // agentDir/extensions directly it would look for extensions/extensions/ (wrong),
  // fall back to adding the directory itself, and loadExtension would fail trying
  // to jiti.import() a directory.
  const noExtensions = !workspaceTrusted
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noExtensions,
    additionalExtensionPaths: noExtensions ? [agentDir] : [],
  })
  try {
    await loader.reload()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    outputLine(
      'warn',
      `[packages] One or more Pi packages failed to install and were skipped: ${msg}`
    )
  }
  _cachedResourceLoader = { cwd, workspaceTrusted, loader }
  return loader
}
