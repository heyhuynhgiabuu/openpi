import type { BrowserWindow, IpcMain } from 'electron'
import { z } from 'zod'
import type {
  AppInfo,
  AppUpdateStatus,
  PiUpdateCheckResult,
  PiUpdateInstallResult,
} from '../../src/lib/ipc'
import { appUpdateStatusSchema, IPC } from '../../src/lib/ipc'
import type {
  checkPiUpdate as checkPiUpdateVersion,
  installPiUpdate as installPiVersion,
} from '../pi/updater'
import type { getAppInfo as readAppInfo } from '../services/shellEnv'
import type {
  checkForAppUpdate as checkForApplicationUpdate,
  quitAndInstall as installApplicationUpdate,
  openReleasePage as openApplicationReleasePage,
  readChangelog as readApplicationChangelog,
} from '../services/updater'

interface UpdateIpcDeps {
  ipcMain: IpcMain
  getMainWindow: () => BrowserWindow | null
  getAppInfo: typeof readAppInfo
  checkPiUpdate: typeof checkPiUpdateVersion
  installPiUpdate: typeof installPiVersion
  checkForAppUpdate: typeof checkForApplicationUpdate
  openReleasePage: typeof openApplicationReleasePage
  quitAndInstall: typeof installApplicationUpdate
  readChangelog: typeof readApplicationChangelog
}

export function registerUpdateIpc(deps: UpdateIpcDeps): void {
  deps.ipcMain.handle(IPC.GET_APP_INFO, async (): Promise<AppInfo> => deps.getAppInfo())

  deps.ipcMain.handle(IPC.CHECK_PI_UPDATE, async (): Promise<PiUpdateCheckResult> => {
    return deps.checkPiUpdate()
  })

  deps.ipcMain.handle(
    IPC.INSTALL_PI_UPDATE,
    async (_event, raw: unknown): Promise<PiUpdateInstallResult> => {
      const { latestVersion } = z.object({ latestVersion: z.string().min(1) }).parse(raw)
      return deps.installPiUpdate(latestVersion)
    }
  )

  deps.ipcMain.handle(IPC.APP_UPDATE_CHECK, async (): Promise<AppUpdateStatus> => {
    const status = appUpdateStatusSchema.parse(await deps.checkForAppUpdate())
    deps.getMainWindow()?.webContents.send(IPC.APP_UPDATE_STATUS, status)
    return status
  })

  deps.ipcMain.handle(IPC.APP_UPDATE_OPEN_RELEASE, (_event, raw: unknown): void => {
    const { url } = z.object({ url: z.string().url() }).parse(raw)
    deps.openReleasePage(url)
  })

  deps.ipcMain.handle(IPC.APP_UPDATE_INSTALL, (): void => {
    deps.quitAndInstall()
  })

  deps.ipcMain.handle(IPC.GET_CHANGELOG, (): string | null => {
    return deps.readChangelog()
  })
}
