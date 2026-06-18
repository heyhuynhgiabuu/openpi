import { type IpcMain, shell } from 'electron'
import { z } from 'zod'
import type { PiSettings, SettingsResult } from '../../src/lib/ipc'
import { IPC, saveSettingsSchema } from '../../src/lib/ipc'
import type { SidecarCommand, SidecarMessage } from '../pi/sidecar'
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
  createRequestId: () => string
  requestSidecar: <T extends SidecarMessage>(
    message: SidecarCommand & { requestId: string }
  ) => Promise<T>
  sendSidecar: (message: SidecarCommand) => void
}

const defaultProjectTrustSchema = z.enum(['ask', 'always', 'never'])

export function registerSettingsIpc(deps: SettingsIpcDeps): void {
  deps.ipcMain.handle(IPC.GET_SETTINGS, (): SettingsResult => {
    return deps.getSettings(deps.getAgentDir(), deps.getCwd())
  })

  deps.ipcMain.handle(IPC.SAVE_SETTINGS, (_event, raw: unknown): void => {
    const { scope, settings } = saveSettingsSchema.parse(raw)
    deps.saveSettings(scope, settings as PiSettings, deps.getAgentDir(), deps.getCwd())
  })

  deps.ipcMain.handle(
    IPC.GET_DEFAULT_PROJECT_TRUST,
    async (): Promise<'ask' | 'always' | 'never'> => {
      const response = await deps.requestSidecar<
        Extract<SidecarMessage, { type: 'default_project_trust_result' }>
      >({
        type: 'get_default_project_trust',
        requestId: deps.createRequestId(),
      })
      return defaultProjectTrustSchema.parse(response.defaultProjectTrust)
    }
  )

  deps.ipcMain.handle(
    IPC.SET_DEFAULT_PROJECT_TRUST,
    async (_event, raw: unknown): Promise<void> => {
      const { defaultProjectTrust } = z
        .object({ defaultProjectTrust: defaultProjectTrustSchema })
        .parse(raw)
      // SettingsManager is a sidecar concern; route the mutation through it
      // so the change is reflected in the running session immediately.
      deps.sendSidecar({ type: 'set_default_project_trust', defaultProjectTrust })
    }
  )

  deps.ipcMain.handle(IPC.OPEN_EXTERNAL, (_event, url: unknown): void => {
    if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
      void shell.openExternal(url)
    }
  })
}
