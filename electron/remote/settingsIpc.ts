/**
 * remote/settingsIpc — Settings → Remote surface.
 *
 * The renderer is render-only: it toggles, pairs, and revokes through these
 * handlers; every decision stays in RemoteHost/main. The enabled preference
 * persists so the user's explicit choice is restored on the next launch.
 */

import type { IpcMain } from 'electron'
import type { RemotePairStart, RemoteSetEnabledRequest, RemoteStatus } from '../../src/lib/ipc'
import { remoteRevokeRequestSchema, remoteSetEnabledRequestSchema, IPC } from '../../src/lib/ipc'
import type { RemoteHost } from './remoteHost'

export const REMOTE_ENABLED_PREF = 'remote.enabled'

export interface RemoteIpcDeps {
  ipcMain: IpcMain
  getHost: () => RemoteHost | null
  getPref: (key: string) => string | null
  setPref: (key: string, value: string) => void
}

export function registerRemoteIpc(deps: RemoteIpcDeps): void {
  const requireHost = (): RemoteHost => {
    const host = deps.getHost()
    if (!host) throw new Error('Remote host unavailable')
    return host
  }

  deps.ipcMain.handle(IPC.REMOTE_STATUS, async (): Promise<RemoteStatus> => {
    const host = deps.getHost()
    if (!host) return { enabled: false, port: null, devices: [] }
    return { ...host.status(), devices: host.devices() }
  })

  deps.ipcMain.handle(
    IPC.REMOTE_SET_ENABLED,
    async (_event, raw: unknown): Promise<RemoteStatus> => {
      const { enabled } = remoteSetEnabledRequestSchema.parse(raw)
      const host = requireHost()
      if (enabled) {
        await host.enable()
      } else {
        await host.disable()
        host.cancelPairing()
      }
      // Persist the explicit user choice; restored on the next launch.
      deps.setPref(REMOTE_ENABLED_PREF, enabled ? 'true' : 'false')
      return { ...host.status(), devices: host.devices() }
    }
  )

  deps.ipcMain.handle(IPC.REMOTE_BEGIN_PAIRING, async (): Promise<RemotePairStart> => {
    return requireHost().beginPairing()
  })

  deps.ipcMain.handle(IPC.REMOTE_CANCEL_PAIRING, async (): Promise<void> => {
    requireHost().cancelPairing()
  })

  deps.ipcMain.handle(IPC.REMOTE_REVOKE_DEVICE, async (_event, raw: unknown): Promise<void> => {
    const { id } = remoteRevokeRequestSchema.parse(raw)
    requireHost().revokeDevice(id)
  })
}
