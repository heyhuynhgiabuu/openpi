/**
 * remote/remoteHost — the remote P0 surface's owner in Electron main.
 *
 * The server exists only while the user has Remote enabled this session: off
 * until enabled in Settings, never auto-starts (a relaunch starts OFF, by
 * design — see the Settings amendment in the remote design doc), stopped by
 * the kill switch. This module owns the single
 * start/stop instance plus its collaborators: a device store over the shared
 * SQLite handle, auth, the gate registry, the SSE hub, and the read-model
 * handlers. The desktop Settings UI toggles enable/disable; nothing else may.
 */

import path from 'node:path'
import type { SessionAuthDeps } from '../session/sessionAuth'
import type { SessionIndexStore } from '../session/sessionIndex'
import { RemoteAuth } from './auth'
import type { RemoteDeviceRow } from './devices'
import { RemoteDeviceStore } from './devices'
import { GateRegistry, type GateSnapshot, type OpenedGate } from './gates'
import {
  interceptExtensionUi,
  resolveFromRenderer,
  withdrawFromPromptEnd,
  type ExtensionUiRelay,
} from './extensionUiBridge'
import type { ExtensionUiRequest, ExtensionUiResponse } from '../../src/lib/extensionUiTypes'
import { createRemoteHandlers } from './handlers'
import { SseHub } from './sse'
import { startRemoteServer, type RunningRemoteServer } from './server'

export const REMOTE_PORT = 8787

export interface RemoteHostDeps {
  sessionIndex: () => SessionIndexStore | null
  sessionAuth: SessionAuthDeps
  port?: number
  /** Directory of the built PWA shell; shell routes 404 when absent. */
  shellDir?: string
}

export interface RemoteToggleResult {
  port: number
}

export interface RemoteStatus {
  enabled: boolean
  port: number | null
}

export class RemoteHost {
  private server: RunningRemoteServer | null = null
  private hub: SseHub | null = null
  private registry: GateRegistry | null = null
  private auth: RemoteAuth | null = null
  private deviceStore: RemoteDeviceStore | null = null
  private starting: Promise<RemoteToggleResult> | null = null

  constructor(private readonly deps: RemoteHostDeps) {}

  get isActive(): boolean {
    return this.server !== null
  }

  /** Idempotent enable. Resolves with the bound port for the Settings UI. */
  async enable(): Promise<RemoteToggleResult> {
    if (this.server) return { port: this.server.port }
    if (this.starting) return this.starting
    const index = this.deps.sessionIndex()
    if (!index) throw new Error('Remote requires the session index store')
    this.starting = this.doEnable(index).finally(() => {
      this.starting = null
    })
    return this.starting
  }

  /** Idempotent kill switch; safe when already off. */
  async disable(): Promise<void> {
    if (this.starting) await this.starting.catch(() => undefined)
    const hub = this.hub
    const server = this.server
    this.server = null
    this.hub = null
    this.registry = null
    this.auth = null
    this.deviceStore = null
    hub?.stop()
    await server?.stop()
  }

  /** Fan-out hook: main forwards every validated session event here. */
  dispatchSessionEvent(event: { type?: string; id?: string }): void {
    // A bridged prompt's end withdraws its gate: the phone's card clears and a
    // late remote answer fails closed. Answers/cancels/aborts all land here.
    if (event.type === 'ui_prompt_end' && typeof event.id === 'string') {
      withdrawFromPromptEnd(event.id)
    }
    this.hub?.onSessionEvent(event)
  }

  /** Kills a device's access instantly: revocation plus any live SSE streams. */
  revokeDevice(deviceId: number): boolean {
    const revoked = this.auth?.revokeDevice(deviceId) ?? false
    this.hub?.dropDevice(deviceId)
    return revoked
  }

  // ── Settings UI surface ─────────────────────────────────────────────

  status(): RemoteStatus {
    return { enabled: this.server !== null, port: this.server?.port ?? null }
  }

  /** Shows the one 6-digit code; any previous pending pairing is replaced. */
  beginPairing(): { code: string; expiresAt: number } {
    return this.requireEnabled().beginPairing()
  }

  cancelPairing(): void {
    this.auth?.cancelPending()
  }

  /** Device rows WITHOUT token material — this crosses the IPC boundary. */
  devices(): Array<Omit<RemoteDeviceRow, 'tokenHash'>> {
    return (this.deviceStore?.list() ?? []).map(({ tokenHash: _hash, ...row }) => row)
  }

  private requireEnabled(): RemoteAuth {
    if (!this.auth || !this.server) throw new Error('Remote is not enabled')
    return this.auth
  }

  pendingGates(): GateSnapshot[] {
    return this.registry?.listPending() ?? []
  }

  /** Bridge hop for desktop confirms; null when remote is off. */
  openBridgeGate(input: {
    title: string
    summary: string
    payload?: unknown
    ttlMs: number
  }): OpenedGate | null {
    if (!this.registry || !this.server) return null
    return this.registry.open({
      kind: 'confirm',
      title: input.title,
      summary: input.summary,
      payload: input.payload,
      ttlMs: input.ttlMs,
    })
  }

  /** Desktop-side settlement of a bridged gate; false when remote won first. */
  settleBridgeGate(gateId: string, approved: boolean): boolean {
    return this.registry?.settleLocally(gateId, { approved, via: 'desktop' }) ?? false
  }

  /**
   * Registry hop for extension UI prompts (confirms + preapply reviews).
   * Returns true when bridged; the renderer gets the dialog either way.
   */
  bridgeExtensionUi(request: ExtensionUiRequest, relay: ExtensionUiRelay): boolean {
    const registry = this.registry
    if (!this.server || !registry) return false
    return interceptExtensionUi({
      request,
      openGate: (gate) =>
        registry.open({
          kind: 'confirm',
          title: gate.title,
          summary: gate.summary,
          payload: gate.payload,
          ttlMs: gate.ttlMs,
        }),
      settle: (gate, approved) =>
        registry.settleLocally(gate.gate.id, { approved, via: 'desktop' }),
      withdraw: (gate) => registry.withdraw(gate.gate.id),
      relay,
    })
  }

  /**
   * Renderer answered a bridged prompt: 'drop' means remote already answered
   * and the sidecar must not see a second response for the id.
   */
  resolveExtensionUiFromRenderer(response: ExtensionUiResponse): 'relay' | 'drop' {
    return resolveFromRenderer(response)
  }

  private async doEnable(index: SessionIndexStore): Promise<RemoteToggleResult> {
    try {
      const store = new RemoteDeviceStore(index.database)
      const auth = new RemoteAuth(store)
      const registry = new GateRegistry()
      const hub = new SseHub(registry)
      const handlers = createRemoteHandlers({
        auth: this.deps.sessionAuth,
        sessionIndex: this.deps.sessionIndex,
        registry,
      })
      const server = await startRemoteServer({
        auth,
        handlers,
        port: this.deps.port ?? REMOTE_PORT,
        hub,
        shellDir: this.deps.shellDir,
      })
      // Commit only once the socket is live: a failed enable leaves no state.
      this.auth = auth
      this.registry = registry
      this.hub = hub
      this.server = server
      this.deviceStore = store
      hub.start()
      return { port: server.port }
    } catch (error) {
      this.auth = null
      this.registry = null
      this.hub = null
      this.server = null
      throw error
    }
  }
}

// ── main.ts factory ──────────────────────────────────────────────────────────

export interface RemoteHostFactoryDeps {
  sessionIndex: () => SessionIndexStore | null
  getAgentDir: () => string
  getSessionState: () => SessionAuthDeps['getSessionState'] extends () => infer T ? T : never
  activeWorkspacePath: () => string | null
  shellDir?: string
}

export function createRemoteHost(deps: RemoteHostFactoryDeps): RemoteHost {
  return new RemoteHost({
    sessionIndex: deps.sessionIndex,
    sessionAuth: {
      getAgentDir: deps.getAgentDir,
      getSessionState: deps.getSessionState,
      getSessionIndex: deps.sessionIndex,
      activeWorkspacePath: deps.activeWorkspacePath,
    },
    shellDir: deps.shellDir,
  })
}

/** Built PWA location: resources in a packaged app, the build dir in dev. */
export function defaultShellDir(paths: {
  packaged: boolean
  resourcesPath: string
  appPath: string
}): string {
  return paths.packaged
    ? path.join(paths.resourcesPath, 'pwa')
    : path.join(paths.appPath, 'out', 'pwa')
}
