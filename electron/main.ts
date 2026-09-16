import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import type { GitStatusResult, OutputLine } from '../src/lib/ipc'
import { IPC } from '../src/lib/ipc'
import { registerMainIpcHandlers } from './ipc/register'
import { createSidecarMessageHandler } from './pi/messages'
import { createRemoteHost, type RemoteHost } from './remote/remoteHost'
import type { SidecarCommand, SidecarMessage } from './pi/sidecar'
import { checkPiUpdate } from './pi/updater'
import { startArtifactWatcher } from './services/artifactWatcher'
import { installProcessCrashHooks } from './services/processCrashHooks'
import { handleLocalFileProtocol, registerLocalFileScheme } from './services/localFileProtocol'
import {
  ensureFffInitialized,
  getCustomizationsHost,
  getFffHost,
  getGitHost,
  getPtyHost,
  hasFffHost,
  hasGitHost,
  hasPtyHost,
} from './services/mainHosts'
import {
  emitSessionError,
  playSoundEffect,
  setMainWindow,
  setSessionIndex,
  showSystemNotification,
} from './services/notificationHost'
import { dockIconPath, enrichPathFromLoginShell, getAgentDir } from './services/shellEnv'
import { startStatusWatchers } from './services/statusWatchers'
import { checkForAppUpdate, initAutoUpdater } from './services/updater'
import { createMainWindow } from './services/windowHost'
import { bindWebContents } from './services/workbenchContext'
import {
  activeWorkspacePath,
  applySessionReady,
  clearSessionState,
  createRequestId,
  ensurePiSidecarStarted,
  getPiSidecarHost,
  getSessionState,
  normalizeSessionReady,
  refreshSessionIndex,
  resolveActiveCwd,
  setOnMaybeCheckPiUpdate,
  setOnOutputLine,
  setOnRestartGitMonitoring,
  setOnSidecarMessage,
  setOnStopGitMonitoring,
  setSessionHostMainWindow,
  setSessionHostSessionIndex,
  showDeferredWorkspace,
} from './session/sessionHost'
import { SessionIndexStore } from './session/sessionIndex'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const _require = createRequire(import.meta.url)

// ── Login-shell PATH enrichment ──────────────────────────────────────────────
// macOS GUI apps launched from Finder/Dock receive a stripped PATH
// (/usr/bin:/bin:/usr/sbin:/sbin) that omits nvm, Homebrew, etc.
// We run the user's login shell once at startup to harvest the full PATH
// so subprocesses (npm, git, node) can be found regardless of launch method.
enrichPathFromLoginShell()

app.setName('OpenPi')
app.setAppUserModelId('dev.openpi.app')

async function confirmHighRiskMutation(options: {
  title: string
  message: string
  detail: string
}): Promise<boolean> {
  if (!mainWindow) return false
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: options.title,
    message: options.message,
    detail: options.detail,
    buttons: ['Cancel', 'Approve'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  })
  return result.response === 1
}

// ─── Session state ─────────────────────────────────────────────────────────────
// Module state is owned by sessionHost.ts; main.ts reads it via getters.
// The lazy-import promises below are local since they bridge to Electron-main
// module resolution, not session lifecycle.

let mainWindow: BrowserWindow | null = null
let sessionIndex: SessionIndexStore | null = null

// Remote P0: off until the user enables it; never auto-starts (design doc).
let remoteHost: RemoteHost | null = null

function emitSessionEventToRemote(event: { type?: string }): void {
  remoteHost?.dispatchSessionEvent(event)
}

function remoteShellDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'pwa')
    : path.join(app.getAppPath(), 'out', 'pwa')
}

// ── Output ring buffer ─────────────────────────────────────────────────
// Lines emitted before the Output pane opens are held here so they are
// replayed when the renderer calls GET_OUTPUT_BUFFER on mount.
const OUTPUT_BUFFER_MAX = 500
const outputBuffer: OutputLine[] = []

function emitOutputLine(line: OutputLine): void {
  outputBuffer.push(line)
  if (outputBuffer.length > OUTPUT_BUFFER_MAX) outputBuffer.shift()
  mainWindow?.webContents.send(IPC.OUTPUT_APPEND, line)
}

installProcessCrashHooks(emitOutputLine)

async function restartGitMonitoring(cwd: string): Promise<void> {
  const git = await getGitHost()
  git.startGitPoll(cwd, (status: GitStatusResult) => {
    mainWindow?.webContents.send(IPC.GIT_STATUS_CHANGED, status)
  })
  git.startFileTreeWatch(cwd, () => {
    mainWindow?.webContents.send(IPC.FILE_TREE_CHANGED)
  })
}

async function maybeCheckPiUpdateOnStartup(): Promise<void> {
  if (sessionIndex?.getPref('updates.check_on_startup') === 'false') return

  const result = await checkPiUpdate()
  if (result.updateAvailable) {
    const line: OutputLine = {
      level: 'info',
      text: `[updates] Pi ${result.latestVersion} is available; current bundled SDK is ${result.currentVersion}.`,
      ts: Date.now(),
    }
    emitOutputLine(line)
  }
}

// ─── Session host ──────────────────────────────────────────────────────────────

const handleSidecarMessage = createSidecarMessageHandler({
  getMainWindow: () => mainWindow,
  normalizeSessionReady,
  applySessionReady,
  refreshSessionIndex,
  resolveActiveCwd,
  showSystemNotification,
  playSoundEffect,
  getGitHost,
  emitSessionError,
  emitOutputLine,
  emitSessionEvent: emitSessionEventToRemote,
})

// ─── IPC handlers ──────────────────────────────────────────────────────────────

function registerHandlers(): void {
  registerMainIpcHandlers({
    ipcMain,
    getMainWindow: () => mainWindow,
    outputBuffer,
    getSessionIndex: () => sessionIndex,
    getCustomizationsHost,
    getFffHost,
    ensureFffInitialized,
    getGitHost,
    restartGitMonitoring,
    hasPtyHost,
    getPtyHost,
    confirmHighRiskMutation,
    getRemoteHost: () => remoteHost,
    emitOutputLine,
    createRequestId,
    requestSidecar: <T extends SidecarMessage>(message: SidecarCommand & { requestId: string }) =>
      getPiSidecarHost()?.request<T>(message) ??
      Promise.reject(new Error('Pi sidecar not running')),
    sendSidecar: (message: SidecarCommand) => {
      getPiSidecarHost()?.send(message)
    },
  })
}

// ─── Window ────────────────────────────────────────────────────────────────────

function createWindow(): void {
  mainWindow = createMainWindow({
    currentDir,
    getPtyHost,
    getSessionIndex: () => sessionIndex,
    ensurePiSidecarStarted,
    showDeferredWorkspace,
    refreshSessionIndex,
    onClosed: () => {
      mainWindow = null
    },
  })
}

// ─── Local file protocol — safe image serving from renderer ─────────────────────
// Registers localfile:// so the sandboxed renderer can load arbitrary
// local images without CSP / sandbox restrictions. Must run before app is ready.
registerLocalFileScheme()

// ─── App lifecycle ─────────────────────────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  if (process.platform === 'darwin') app.dock?.setIcon(dockIconPath())

  handleLocalFileProtocol(() => getSessionState()?.cwd ?? null)

  sessionIndex = new SessionIndexStore(path.join(app.getPath('userData'), 'openpi.sqlite'))
  setSessionIndex(sessionIndex)
  setSessionHostSessionIndex(sessionIndex)

  remoteHost = createRemoteHost({
    sessionIndex: () => sessionIndex,
    getAgentDir,
    getSessionState,
    activeWorkspacePath,
    shellDir: remoteShellDir(),
  })

  // Restore the user's explicit choice from a previous session; the server
  // never starts for any reason other than this preference or the toggle.
  if (sessionIndex.getPref('remote.enabled') === 'true') {
    remoteHost.enable().catch((error: unknown) => {
      emitOutputLine({
        level: 'warn',
        text: `[remote] could not re-enable: ${error instanceof Error ? error.message : String(error)}`,
        ts: Date.now(),
      })
    })
  }

  // Wire sessionHost callbacks
  setOnSidecarMessage(handleSidecarMessage)
  setOnOutputLine(emitOutputLine)
  setOnRestartGitMonitoring((cwd) => void restartGitMonitoring(cwd))
  setOnStopGitMonitoring(() => {
    void getGitHost().then((host) => {
      host.stopFileTreeWatch()
      host.stopGitPoll()
    })
    void getFffHost().then((host) => host.destroyFff())
  })
  setOnMaybeCheckPiUpdate(() => {
    void maybeCheckPiUpdateOnStartup().catch((err) => {
      const line: OutputLine = {
        level: 'warn',
        text: `[updates] ${err instanceof Error ? err.message : String(err)}`,
        ts: Date.now(),
      }
      emitOutputLine(line)
    })
  })

  registerHandlers()
  createWindow()
  setMainWindow(mainWindow)
  setSessionHostMainWindow(mainWindow)

  // ── Auto-updater ─────────────────────────────────────────────────────────
  initAutoUpdater(mainWindow)

  // ── Workbench context bridge ─────────────────────────────────────────────
  if (mainWindow) bindWebContents(mainWindow.webContents)

  startStatusWatchers({
    getMainWindow: () => mainWindow,
    getSessionIndex: () => sessionIndex,
    getPiSidecarHost,
    checkForAppUpdate,
  })

  const artifactWatcher = startArtifactWatcher({
    getMainWindow: () => mainWindow,
    getWorkspacePath: () => activeWorkspacePath(),
  })

  app.on('before-quit', () => artifactWatcher.stop())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('quit', () => {
  if (hasGitHost())
    void getGitHost().then((g) => {
      g.stopGitPoll()
      g.stopFileTreeWatch()
    })
  if (hasFffHost()) void getFffHost().then((host) => host.destroyFff())
  if (getPiSidecarHost()) void getPiSidecarHost()!.stop()
  clearSessionState()
  if (hasPtyHost()) void getPtyHost().then((p) => p.closeAll())
  void remoteHost?.disable()
  sessionIndex?.close()
})
