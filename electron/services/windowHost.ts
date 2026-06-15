import path from 'node:path'
import type { MenuItemConstructorOptions } from 'electron'
import { BrowserWindow, Menu } from 'electron'
import { IPC } from '../../src/lib/ipc'
import type { SessionIndexStore } from '../session/sessionIndex'
import type { PtyHost } from './ptyHost'
import { appIconPath } from './shellEnv'
import { attachWindowStateSaver, loadWindowState } from './windowState'

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

function buildAppMenu() {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    { role: 'fileMenu' as const },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        { role: 'pasteAndMatchStyle' as const },
        { role: 'delete' as const },
        { role: 'selectAll' as const },
      ],
    },
    { role: 'viewMenu' as const },
    { role: 'windowMenu' as const },
  ]
  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

export function createMainWindow(options: CreateWindowOptions): BrowserWindow {
  buildAppMenu()

  const saved = loadWindowState()
  const mainWindow = new BrowserWindow({
    x: saved.x,
    y: saved.y,
    width: saved.width,
    height: saved.height,
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

  if (saved.isMaximized) mainWindow.maximize()
  if (saved.isFullScreen) mainWindow.setFullScreen(true)
  attachWindowStateSaver(mainWindow)

  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.key.toLowerCase() === 'f' && (input.meta || input.control)) {
      mainWindow.webContents.send(IPC.FILE_FIND_SHORTCUT)
    }
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
