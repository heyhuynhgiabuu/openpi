import { ipcRenderer } from 'electron'
import { IPC } from '../../src/lib/ipc'
import type { TunnelStatus } from '../ipc/tunnel'

export const tunnelApi = {
  getStatus: (): Promise<TunnelStatus> => ipcRenderer.invoke(IPC.TUNNEL_GET_STATUS),
  getUrl: (): Promise<string | null> => ipcRenderer.invoke(IPC.TUNNEL_GET_URL),
  enable: (
    token: string,
    persistent = false,
    reservedName?: string
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.TUNNEL_ENABLE, { token, persistent, reservedName }),
  disable: (): Promise<void> => ipcRenderer.invoke(IPC.TUNNEL_DISABLE),
  generateQr: (url: string): Promise<string> => ipcRenderer.invoke(IPC.TUNNEL_GENERATE_QR, url),
} as const
