import type { BrowserWindow, IpcMain, IpcMainEvent, IpcMainInvokeEvent } from 'electron'

type RendererIpcEvent = IpcMainEvent | IpcMainInvokeEvent

function isTrustedRendererEvent(
  event: RendererIpcEvent,
  getMainWindow: () => BrowserWindow | null
): boolean {
  const mainWindow = getMainWindow()
  if (!mainWindow) return false
  const mainFrame = mainWindow.webContents.mainFrame
  return (
    event.sender === mainWindow.webContents &&
    event.senderFrame === mainFrame &&
    event.senderFrame.url === mainWindow.webContents.getURL()
  )
}

export function createAuthorizedIpcMain(
  ipcMain: IpcMain,
  getMainWindow: () => BrowserWindow | null
): IpcMain {
  const authorizedHandle = (channel: string, listener: Parameters<IpcMain['handle']>[1]) =>
    ipcMain.handle(channel, (event, ...args) => {
      if (!isTrustedRendererEvent(event, getMainWindow)) {
        throw new Error('Unauthorized IPC sender')
      }
      return listener(event, ...args)
    })

  const authorizedOn = (channel: string, listener: Parameters<IpcMain['on']>[1]) =>
    ipcMain.on(channel, (event, ...args) => {
      if (!isTrustedRendererEvent(event, getMainWindow)) {
        console.warn(`[openpi:ipc] Ignored unauthorized event on ${channel}`)
        return
      }
      listener(event, ...args)
    })

  return new Proxy(ipcMain, {
    get(target, property) {
      if (property === 'handle') return authorizedHandle
      if (property === 'on') return authorizedOn
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}
