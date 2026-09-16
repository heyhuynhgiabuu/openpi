import type { IpcMain } from 'electron'
import {
  resolveExtensionUiResponseSchema,
  type ExtensionUiResponse,
} from '../../src/lib/extensionUiTypes'
import { IPC } from '../../src/lib/ipc'
import { requirePiSidecar } from '../session/sessionHost'
import type { SidecarCommand } from './sidecar'

export function registerExtensionUiHandlers(
  ipcMain: IpcMain,
  onRendererResponse?: (response: ExtensionUiResponse) => 'relay' | 'drop'
): void {
  ipcMain.handle(IPC.RESOLVE_EXTENSION_UI, (_event, raw: unknown): void => {
    const response = resolveExtensionUiResponseSchema.parse(raw)
    // A bridged prompt the remote already answered must not reach the
    // sidecar twice: first settle wins, the stale desktop answer is dropped.
    if (onRendererResponse?.(response) === 'drop') return
    requirePiSidecar().send({
      type: 'extension_ui_response',
      id: response.id,
      cancelled: response.cancelled,
      confirmed: response.confirmed,
      value: response.value,
      approved: response.approved,
      remember: response.remember,
    } satisfies SidecarCommand)
  })
}
