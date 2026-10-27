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
  createCodemodeExtension,
  createMcpExtension,
  createToolSearchExtension,
  DefaultResourceLoader,
  ModelRuntime,
  type InlineExtension,
} from '@earendil-works/pi-coding-agent'
import { ProviderAuthBridge } from './providerAuth'
import { createSessionSettingsManager } from './sessionSettings'
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

// Pi's built-in codemode, registered the way the CLI registers it (`builtInExtensions`
// in pi-coding-agent). As a `builtin` entry it loads as `builtin:codemode`: on by
// default, off with `-builtin:codemode` in the `extensions` setting, and skipped
// when noExtensions is set (untrusted workspace). The factory registers the tool
// inactive, so `defaultTools: ["+codemode"]` stays the only opt-in.
const CODEMODE_BUILTIN: InlineExtension = {
  name: 'codemode',
  factory: createCodemodeExtension(),
  builtin: true,
  replaceable: true,
}

// Pi's built-in MCP extension, registered the same way (pi-coding-agent
// dist/extensions/index.js `builtInExtensions`). It reads `mcp.json` from the
// agent dir and, only when the project is trusted, from `<cwd>/.pi/mcp.json`
// (dist/extensions/mcp/config.js:106 `loadMcpConfig`, gated by
// `ctx.isProjectTrusted()`). No servers in config means no client load and no
// connection; tools default to `codemode` exposure, which only activates the
// codemode tool when a server actually asks for it. `autoEnableCodemode` is
// left at Pi's default — OpenPi does not force tool activation.
const MCP_BUILTIN: InlineExtension = {
  name: 'mcp',
  factory: createMcpExtension(),
  builtin: true,
  replaceable: true,
}

// Pi's built-in tool-search extension: registers `tool_search` inactive. It is
// only activated by Pi settings (`defaultTools: ["+tool_search"]`) or when MCP
// servers use `"exposure": "deferred"`.
const TOOL_SEARCH_BUILTIN: InlineExtension = {
  name: 'tool-search',
  factory: createToolSearchExtension(),
  builtin: true,
  replaceable: true,
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

  // `projectTrusted` is what `ctx.isProjectTrusted()` reports to extensions; the
  // built-in MCP extension gates `<cwd>/.pi/mcp.json` on it (see sessionSettings.ts).
  const settingsManager = createSessionSettingsManager(cwd, agentDir, workspaceTrusted)
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
    // `noExtensions` drops every `builtin:<name>` path from the load set
    // (dist/core/resource-loader.js:409), so all three builtins are skipped in an
    // untrusted workspace even though they are listed here.
    extensionFactories: [CODEMODE_BUILTIN, MCP_BUILTIN, TOOL_SEARCH_BUILTIN],
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
