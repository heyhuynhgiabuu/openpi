import { type IpcMain, shell } from 'electron'
import type { PiSettings, SettingsResult } from '../../src/lib/ipc'
import { IPC, saveSettingsSchema } from '../../src/lib/ipc'
import type {
  saveSettings as persistSettings,
  getSettings as readSettings,
} from '../services/settingsHost'

interface SettingsIpcDeps {
  ipcMain: IpcMain
  getAgentDir: () => string
  getCwd: () => string | null
  getSettings: typeof readSettings
  saveSettings: typeof persistSettings
}

export function registerSettingsIpc(deps: SettingsIpcDeps): void {
  deps.ipcMain.handle(IPC.GET_SETTINGS, (): SettingsResult => {
    return deps.getSettings(deps.getAgentDir(), deps.getCwd())
  })

  deps.ipcMain.handle(IPC.SAVE_SETTINGS, (_event, raw: unknown): void => {
    const { scope, settings } = saveSettingsSchema.parse(raw)
    deps.saveSettings(scope, settings as PiSettings, deps.getAgentDir(), deps.getCwd())
  })

  deps.ipcMain.handle(IPC.OPEN_EXTERNAL, (_event, url: unknown): void => {
    if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
      void shell.openExternal(url)
    }
  })
}
