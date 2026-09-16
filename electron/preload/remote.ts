import { ipcRenderer } from 'electron'
import type { RemotePairStart, RemoteStatus } from '../../src/lib/ipc'
import { IPC } from '../../src/lib/ipc'

/**
 * Settings → Remote bridge. The renderer only ever sees status snapshots and
 * device rows — no tokens, no hashes, no host internals.
 */
export const remoteApi = {
  remoteStatus: (): Promise<RemoteStatus> => ipcRenderer.invoke(IPC.REMOTE_STATUS),

  remoteSetEnabled: (enabled: boolean): Promise<RemoteStatus> =>
    ipcRenderer.invoke(IPC.REMOTE_SET_ENABLED, { enabled }),

  remoteBeginPairing: (): Promise<RemotePairStart> => ipcRenderer.invoke(IPC.REMOTE_BEGIN_PAIRING),

  remoteCancelPairing: (): Promise<void> => ipcRenderer.invoke(IPC.REMOTE_CANCEL_PAIRING),

  remoteRevokeDevice: (id: number): Promise<void> =>
    ipcRenderer.invoke(IPC.REMOTE_REVOKE_DEVICE, { id }),
}
