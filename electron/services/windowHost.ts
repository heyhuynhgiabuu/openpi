import path from 'node:path'
import { BrowserWindow } from 'electron'
import { IPC } from '../../src/lib/ipc'
import type { SessionIndexStore } from '../session/sessionIndex'
import type { PtyHost } from './ptyHost'
import { appIconPath } from './shellEnv'

type PtyHostInstance = InstanceType<typeof PtyHost>

interface CreateWindowOptions {
  currentDir: string
  getPtyHost: () => Promise<PtyHostInstance>
  getSessionIndex: () => SessionIndexStore | null
  ensurePiSidecarStarted: () => unknown
  showDeferredWorkspace: (workspacePath: string) => void
  refreshSessionIndex: () => Promise<void>
  onClosed: () => void
}

export function createMainWindow(options: CreateWindowOptions): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'OpenPi',
    icon: appIconPath(),
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#111111',
    webPreferences: {
      preload: path.resolve(options.currentDir, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.resolve(options.currentDir, '../renderer/index.html'))
  }

  mainWindow.webContents.once('did-finish-load', () => {
    options.ensurePiSidecarStarted()
    void options.getPtyHost().then((pty) => pty.setSender(mainWindow.webContents))

    mainWindow.webContents.send(IPC.SESSION_INDEX_UPDATED)

    const lastWorkspace = options.getSessionIndex()?.getLastWorkspace()
    if (lastWorkspace) {
      options.showDeferredWorkspace(lastWorkspace)
    } else {
      void options.refreshSessionIndex()
    }
  })

  mainWindow.on('closed', options.onClosed)
  return mainWindow
}
