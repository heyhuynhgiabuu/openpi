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

type InvokeListener = Parameters<IpcMain['handle']>[1]
type EventListener = Parameters<IpcMain['on']>[1]

export function createAuthorizedIpcMain(
  ipcMain: IpcMain,
  getMainWindow: () => BrowserWindow | null
): IpcMain {
  /** Every registration path goes through one of these, `*Once` included. */
  const guardedInvoke =
    (listener: InvokeListener): InvokeListener =>
    (event, ...args) => {
      if (!isTrustedRendererEvent(event, getMainWindow)) {
        throw new Error('Unauthorized IPC sender')
      }
      return listener(event, ...args)
    }

  const guardedEvent =
    (channel: string, listener: EventListener): EventListener =>
    (event, ...args) => {
      if (!isTrustedRendererEvent(event, getMainWindow)) {
        console.warn(`[openpi:ipc] Ignored unauthorized event on ${channel}`)
        return
      }
      listener(event, ...args)
    }

  return new Proxy(ipcMain, {
    get(target, property) {
      if (property === 'handle') {
        return (channel: string, listener: InvokeListener) =>
          target.handle(channel, guardedInvoke(listener))
      }
      if (property === 'handleOnce') {
        return (channel: string, listener: InvokeListener) =>
          target.handleOnce(channel, guardedInvoke(listener))
      }
      if (property === 'on') {
        return (channel: string, listener: EventListener) =>
          target.on(channel, guardedEvent(channel, listener))
      }
      if (property === 'once') {
        return (channel: string, listener: EventListener) =>
          target.once(channel, guardedEvent(channel, listener))
      }
      // eslint-disable-next-line anti-slop/no-reflect-get -- this Proxy IS the ipc boundary; forwarded properties are dynamic by contract
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}
