import { describe, expect, it, vi } from 'vitest'
import { IPC } from '../src/lib/ipc'

const { electronIpcMain } = vi.hoisted(() => ({
  electronIpcMain: { handle: vi.fn(), on: vi.fn() },
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp') },
  BrowserWindow: { fromWebContents: vi.fn(() => null) },
  dialog: { showMessageBox: vi.fn(), showOpenDialog: vi.fn() },
  ipcMain: electronIpcMain,
  safeStorage: { isEncryptionAvailable: vi.fn(() => false) },
  shell: { openExternal: vi.fn(), trashItem: vi.fn() },
}))

vi.mock('../electron/pi/providerHost', () => ({ registerProviderHandlers: vi.fn() }))
vi.mock('../electron/pi/updater', () => ({ checkPiUpdate: vi.fn(), installPiUpdate: vi.fn() }))
vi.mock('../electron/services/notificationHost', () => ({
  emitSessionError: vi.fn(),
  playSoundEffectId: vi.fn(),
}))
vi.mock('../electron/services/settingsHost', () => ({
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
}))
vi.mock('../electron/services/updater', () => ({
  checkForAppUpdate: vi.fn(),
  openReleasePage: vi.fn(),
  quitAndInstall: vi.fn(),
  readChangelog: vi.fn(),
}))

import { registerMainIpcHandlers } from '../electron/ipc/register'

type IpcHandler = (event: unknown, raw?: unknown) => unknown

describe('main IPC sender authorization', () => {
  it('rejects a foreign sender before a privileged handler runs', async () => {
    const handlers = new Map<string, IpcHandler>()
    const listeners = new Map<string, IpcHandler>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: IpcHandler) => handlers.set(channel, handler)),
      on: vi.fn((channel: string, handler: IpcHandler) => listeners.set(channel, handler)),
    }
    const mainFrame = { url: 'file:///app/index.html' }
    const webContents = { mainFrame, getURL: () => mainFrame.url, send: vi.fn() }
    const getPref = vi.fn(() => 'private-value')

    registerMainIpcHandlers({
      ipcMain: ipcMain as unknown as Parameters<typeof registerMainIpcHandlers>[0]['ipcMain'],
      getMainWindow: () =>
        ({ webContents }) as unknown as NonNullable<
          ReturnType<Parameters<typeof registerMainIpcHandlers>[0]['getMainWindow']>
        >,
      outputBuffer: [],
      getSessionIndex: () =>
        ({ getPref }) as unknown as NonNullable<
          ReturnType<Parameters<typeof registerMainIpcHandlers>[0]['getSessionIndex']>
        >,
      getCustomizationsHost: vi.fn(),
      getFffHost: vi.fn(),
      ensureFffInitialized: vi.fn(),
      getGitHost: vi.fn(),
      restartGitMonitoring: vi.fn(),
      hasPtyHost: () => false,
      getPtyHost: vi.fn(),
      confirmHighRiskMutation: vi.fn(),
      emitOutputLine: vi.fn(),
      createRequestId: vi.fn(() => 'request-1'),
      requestSidecar: vi.fn(),
      sendSidecar: vi.fn(),
    })

    const handler = handlers.get(IPC.GET_PREF)
    if (!handler) throw new Error('Expected GET_PREF handler')
    expect(() =>
      handler({ sender: {}, senderFrame: { url: 'https://attacker.example' } }, { key: 'secret' })
    ).toThrow(/unauthorized ipc sender/i)
    expect(getPref).not.toHaveBeenCalled()

    expect(handler({ sender: webContents, senderFrame: mainFrame }, { key: 'secret' })).toBe(
      'private-value'
    )
  })
})
