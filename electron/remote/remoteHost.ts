/**
 * remote/remoteHost — the remote P0 surface's owner in Electron main.
 *
 * The server exists only while the user has Remote enabled: off until enabled,
 * never auto-starts, stopped by the kill switch. This module owns the single
 * start/stop instance plus its collaborators: a device store over the shared
 * SQLite handle, auth, the gate registry, the SSE hub, and the read-model
 * handlers. The desktop Settings UI toggles enable/disable; nothing else may.
 */

import type { SessionAuthDeps } from '../session/sessionAuth'
import type { SessionIndexStore } from '../session/sessionIndex'
import { RemoteAuth } from './auth'
import { RemoteDeviceStore } from './devices'
import { GateRegistry, type GateSnapshot } from './gates'
import { createRemoteHandlers } from './handlers'
import { SseHub } from './sse'
import { startRemoteServer, type RunningRemoteServer } from './server'

export const REMOTE_PORT = 8787

export interface RemoteHostDeps {
  sessionIndex: () => SessionIndexStore | null
  sessionAuth: SessionAuthDeps
  port?: number
}

export interface RemoteToggleResult {
  port: number
}

export class RemoteHost {
  private server: RunningRemoteServer | null = null
  private hub: SseHub | null = null
  private registry: GateRegistry | null = null
  private auth: RemoteAuth | null = null
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
    hub?.stop()
    await server?.stop()
  }

  /** Fan-out hook: main forwards every validated session event here. */
  dispatchSessionEvent(event: { type?: string }): void {
    this.hub?.onSessionEvent(event)
  }

  /** Kills a device's access instantly: revocation plus any live SSE streams. */
  revokeDevice(deviceId: number): boolean {
    const revoked = this.auth?.revokeDevice(deviceId) ?? false
    this.hub?.dropDevice(deviceId)
    return revoked
  }

  pendingGates(): GateSnapshot[] {
    return this.registry?.listPending() ?? []
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
      })
      // Commit only once the socket is live: a failed enable leaves no state.
      this.auth = auth
      this.registry = registry
      this.hub = hub
      this.server = server
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
  })
}
