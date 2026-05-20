import type { IpcMain } from 'electron'
import { getPrefSchema, IPC, setPrefSchema } from '../../src/lib/ipc'

interface PreferencesIpcDeps {
  ipcMain: IpcMain
  getPref: (key: string) => string | null
  setPref: (key: string, value: string) => void
}

export function registerPreferencesIpc(deps: PreferencesIpcDeps): void {
  deps.ipcMain.handle(IPC.GET_PREF, (_event, raw: unknown): string | null => {
    const { key } = getPrefSchema.parse(raw)
    return deps.getPref(key)
  })

  deps.ipcMain.handle(IPC.SET_PREF, (_event, raw: unknown): void => {
    const { key, value } = setPrefSchema.parse(raw)
    deps.setPref(key, value)
  })
}
