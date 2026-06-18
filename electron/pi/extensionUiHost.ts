import type { IpcMain } from 'electron'
import { resolveExtensionUiResponseSchema } from '../../src/lib/extensionUiTypes'
import { IPC } from '../../src/lib/ipc'
import { requirePiSidecar } from '../session/sessionHost'
import type { SidecarCommand } from './sidecar'

export function registerExtensionUiHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IPC.RESOLVE_EXTENSION_UI, (_event, raw: unknown): void => {
    const response = resolveExtensionUiResponseSchema.parse(raw)
    requirePiSidecar().send({
      type: 'extension_ui_response',
      id: response.id,
      cancelled: response.cancelled,
      confirmed: response.confirmed,
      value: response.value,
    } satisfies SidecarCommand)
  })
}
