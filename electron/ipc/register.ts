import type { BrowserWindow, IpcMain } from 'electron'
import type { OutputLine } from '../../src/lib/ipc'
import type * as GitHost from '../git/gitHost'
import { registerGitIpc } from '../git/ipc'
import { registerProviderHandlers } from '../pi/providerHost'
import { checkPiUpdate, installPiUpdate } from '../pi/updater'
import type * as CustomizationsHost from '../services/customizations'
import type * as FffHost from '../services/fffHost'
import { emitSessionError, playSoundEffectId } from '../services/notificationHost'
import { filterBlockedPaths } from '../services/protectedPaths'
import type { PtyHost } from '../services/ptyHost'
import { getSettings, saveSettings as writeSettings } from '../services/settingsHost'
import { getAgentDir, getAppInfo } from '../services/shellEnv'
import {
  checkForAppUpdate,
  openReleasePage,
  quitAndInstall,
  readChangelog,
} from '../services/updater'
import {
  buildWorkbenchContextPrefix,
  getWorkbenchContext,
  updateTerminalOutput,
  updateVisibleFile,
} from '../services/workbenchContext'
import { registerSessionArchiveIpc } from '../session/archiveIpc'
import { registerSessionsIpc } from '../session/ipc'
import {
  activeWorkspacePath,
  applySessionValues,
  createRequestId,
  ensureActiveSession,
  ensurePiSidecarStarted,
  getDeferredWorkspace,
  getPiSidecarHost,
  getSessionState,
  normalizeSessionReady,
  refreshSessionIndex,
  requirePiSidecar,
  startSession,
} from '../session/sessionHost'
import type { SessionIndexStore } from '../session/sessionIndex'
import { registerCustomizationsIpc } from './customizations'
import { registerDiagnosticsIpc } from './diagnostics'
import { registerFileIpc } from './files'
import { registerPreferencesIpc } from './preferences'
import { registerPtyIpc } from './pty'
import { registerResourcesIpc } from './resources'
import { registerSearchIpc } from './search'
import { registerSettingsIpc } from './settings'
import { registerSoundIpc } from './sound'
import { registerThemeIpc } from './themes'
import { registerUpdateIpc } from './update'
import { registerWorkbenchIpc } from './workbench'
import { registerWorkspacesIpc } from './workspaces'

type PtyHostInstance = InstanceType<typeof PtyHost>

interface RegisterMainIpcHandlersDeps {
  ipcMain: IpcMain
  getMainWindow: () => BrowserWindow | null
  outputBuffer: OutputLine[]
  getSessionIndex: () => SessionIndexStore | null
  getCustomizationsHost: () => Promise<typeof CustomizationsHost>
  getFffHost: () => Promise<typeof FffHost>
  ensureFffInitialized: (cwd: string) => Promise<typeof FffHost | null>
  getGitHost: () => Promise<typeof GitHost>
  restartGitMonitoring: (cwd: string) => Promise<void>
  hasPtyHost: () => boolean
  getPtyHost: () => Promise<PtyHostInstance>
  confirmHighRiskMutation: (options: {
    title: string
    message: string
    detail: string
  }) => Promise<boolean>
  emitOutputLine: (line: OutputLine) => void
}

async function getCommitAgentContext(
  sessionIndex: SessionIndexStore | null
): Promise<string | undefined> {
  const sessionFile = getSessionState()?.sessionFile
  if (!sessionFile || !sessionIndex) return undefined
  try {
    const page = await sessionIndex.getSessionMessages(sessionFile, { limit: 10 })
    for (let index = page.messages.length - 1; index >= 0; index--) {
      const message = page.messages[index]
      if (message?.role === 'assistant' && message.text) return message.text
    }
  } catch {
    // non-fatal — session messages may not be available
  }
  return undefined
}

export function registerMainIpcHandlers(deps: RegisterMainIpcHandlersDeps): void {
  registerProviderHandlers()
  registerUpdateIpc({
    ipcMain: deps.ipcMain,
    getMainWindow: deps.getMainWindow,
    getAppInfo,
    checkPiUpdate,
    installPiUpdate,
    checkForAppUpdate,
    openReleasePage,
    quitAndInstall,
    readChangelog,
  })
  registerPtyIpc({
    ipcMain: deps.ipcMain,
    hasPtyHost: deps.hasPtyHost,
    getPtyHost: deps.getPtyHost,
  })
  registerPreferencesIpc({
    ipcMain: deps.ipcMain,
    getPref: (key) => deps.getSessionIndex()?.getPref(key) ?? null,
    setPref: (key, value) => deps.getSessionIndex()?.setPref(key, value),
  })
  registerSoundIpc({ ipcMain: deps.ipcMain, playSoundEffectId })
  registerWorkbenchIpc({
    ipcMain: deps.ipcMain,
    getWorkbenchContext,
    updateTerminalOutput,
    updateVisibleFile,
  })
  registerGitIpc({
    ipcMain: deps.ipcMain,
    getCwd: () => getSessionState()?.cwd ?? null,
    getDeferredWorkspace,
    getGitHost: deps.getGitHost,
    restartGitMonitoring: deps.restartGitMonitoring,
    filterBlockedPaths,
    confirmHighRiskMutation: deps.confirmHighRiskMutation,
    getCommitAgentContext: () => getCommitAgentContext(deps.getSessionIndex()),
  })
  registerFileIpc({
    ipcMain: deps.ipcMain,
    getCwd: () => getSessionState()?.cwd ?? null,
    getMainWindow: deps.getMainWindow,
    getGitHost: deps.getGitHost,
    confirmHighRiskMutation: deps.confirmHighRiskMutation,
  })
  registerSettingsIpc({
    ipcMain: deps.ipcMain,
    getAgentDir,
    getCwd: () => getSessionState()?.cwd ?? null,
    getSettings,
    saveSettings: writeSettings,
  })
  registerSearchIpc({ ipcMain: deps.ipcMain, ensureFffInitialized: deps.ensureFffInitialized })
  registerResourcesIpc({
    ipcMain: deps.ipcMain,
    activeWorkspacePath,
    createRequestId,
    requestSidecar: async (message) => requirePiSidecar().request(message),
    isWorkspaceTrusted: (cwd) => deps.getSessionIndex()?.isWorkspaceTrusted(cwd) ?? false,
    getCwd: () => getSessionState()?.cwd ?? null,
  })
  registerCustomizationsIpc({
    ipcMain: deps.ipcMain,
    getAgentDir,
    getCwd: () => getSessionState()?.cwd ?? getDeferredWorkspace(),
    getCustomizationsHost: deps.getCustomizationsHost,
    isWorkspaceTrusted: (cwd) => deps.getSessionIndex()?.isWorkspaceTrusted(cwd) ?? false,
    confirmHighRiskMutation: deps.confirmHighRiskMutation,
  })
  registerSessionsIpc({
    ipcMain: deps.ipcMain,
    getMainWindow: deps.getMainWindow,
    outputBuffer: deps.outputBuffer,
    startSession,
    emitSessionError,
    ensureActiveSession,
    getSessionState,
    getSessionIndex: deps.getSessionIndex,
    activeWorkspacePath,
    createRequestId,
    sendSidecar: (message) => {
      if (message.type === 'prompt') {
        ensurePiSidecarStarted().send(message)
        return
      }
      requirePiSidecar().send(message)
    },
    requestSidecar: async (message) => requirePiSidecar().request(message),
    buildWorkbenchContextPrefix,
    confirmHighRiskMutation: deps.confirmHighRiskMutation,
    refreshSessionIndex,
    normalizeSessionReady,
    applySessionValues,
  })
  registerWorkspacesIpc({
    ipcMain: deps.ipcMain,
    getGitHost: deps.getGitHost,
    getSessionIndex: deps.getSessionIndex,
    getCustomizationsHost: deps.getCustomizationsHost,
    getAgentDir,
    confirmHighRiskMutation: deps.confirmHighRiskMutation,
  })
  registerSessionArchiveIpc({
    ipcMain: deps.ipcMain,
    getAgentDir,
    getActiveSessionFile: () => getSessionState()?.sessionFile ?? null,
    getActiveCwd: () => getSessionState()?.cwd ?? null,
    startSession,
    refreshSessionIndex,
    emitOutputLine: deps.emitOutputLine,
  })
  registerThemeIpc(deps.ipcMain)
  registerDiagnosticsIpc({
    ipcMain: deps.ipcMain,
    getSessionState,
    getDeferredWorkspace,
    getSessionIndex: deps.getSessionIndex,
    getCustomizationsHost: deps.getCustomizationsHost,
    getGitHost: deps.getGitHost,
    getPiSidecarHost,
  })
}
