import { ipcRenderer } from 'electron'
import type {
  AppUpdateStatus,
  OutputLine,
  PiUpdateCheckResult,
  PiUpdateInstallResult,
  PtyData,
  PtyExit,
  WorkbenchContextPayload,
} from '../../src/lib/ipc'
import { IPC } from '../../src/lib/ipc'

export const terminalApi = {
  pty: {
    create: (cwd: string, cols: number, rows: number): Promise<string> =>
      ipcRenderer.invoke(IPC.PTY_CREATE, { cwd, cols, rows }),
    write: (id: string, data: string): void => ipcRenderer.send(IPC.PTY_WRITE, { id, data }),
    resize: (id: string, cols: number, rows: number): void =>
      ipcRenderer.send(IPC.PTY_RESIZE, { id, cols, rows }),
    close: (id: string): void => ipcRenderer.send(IPC.PTY_CLOSE, { id }),
    onData: (cb: (payload: PtyData) => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: PtyData) => cb(payload)
      ipcRenderer.on(IPC.PTY_DATA, handler)
      return () => ipcRenderer.removeListener(IPC.PTY_DATA, handler)
    },
    onExit: (cb: (payload: PtyExit) => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: PtyExit) => cb(payload)
      ipcRenderer.on(IPC.PTY_EXIT, handler)
      return () => ipcRenderer.removeListener(IPC.PTY_EXIT, handler)
    },
  },

  onOutputAppend: (cb: (line: OutputLine) => void) => {
    const handler = (_: Electron.IpcRendererEvent, line: OutputLine) => cb(line)
    ipcRenderer.on(IPC.OUTPUT_APPEND, handler)
    return () => ipcRenderer.removeListener(IPC.OUTPUT_APPEND, handler)
  },
  getOutputBuffer: (): Promise<OutputLine[]> => ipcRenderer.invoke(IPC.GET_OUTPUT_BUFFER),

  getPref: (key: string): Promise<string | null> => ipcRenderer.invoke(IPC.GET_PREF, { key }),
  setPref: (key: string, value: string): Promise<void> =>
    ipcRenderer.invoke(IPC.SET_PREF, { key, value }),
  playSoundEffect: (sound: string): Promise<void> =>
    ipcRenderer.invoke(IPC.PLAY_SOUND_EFFECT, { sound }),
  checkPiUpdate: (): Promise<PiUpdateCheckResult> => ipcRenderer.invoke(IPC.CHECK_PI_UPDATE),
  installPiUpdate: (latestVersion: string): Promise<PiUpdateInstallResult> =>
    ipcRenderer.invoke(IPC.INSTALL_PI_UPDATE, { latestVersion }),

  getDefaultProjectTrust: (): Promise<'ask' | 'always' | 'never'> =>
    ipcRenderer.invoke(IPC.GET_DEFAULT_PROJECT_TRUST),
  setDefaultProjectTrust: (defaultProjectTrust: 'ask' | 'always' | 'never'): Promise<void> =>
    ipcRenderer.invoke(IPC.SET_DEFAULT_PROJECT_TRUST, { defaultProjectTrust }),

  appUpdate: {
    check: (): Promise<AppUpdateStatus> => ipcRenderer.invoke(IPC.APP_UPDATE_CHECK),
    openRelease: (url: string): Promise<void> =>
      ipcRenderer.invoke(IPC.APP_UPDATE_OPEN_RELEASE, { url }),
    install: (): Promise<void> => ipcRenderer.invoke(IPC.APP_UPDATE_INSTALL),
    onStatus: (cb: (status: AppUpdateStatus) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, status: AppUpdateStatus) => cb(status)
      ipcRenderer.on(IPC.APP_UPDATE_STATUS, handler)
      return () => ipcRenderer.removeListener(IPC.APP_UPDATE_STATUS, handler)
    },
  },

  workbenchContext: {
    update: (payload: {
      visibleFile: string | null
      visibleFileAbs: string | null
      terminalOutput: string | null
    }): void => ipcRenderer.send(IPC.WORKBENCH_CONTEXT_UPDATE, payload),
    get: (): Promise<WorkbenchContextPayload> => ipcRenderer.invoke(IPC.WORKBENCH_CONTEXT_GET),
    onChange: (cb: (context: WorkbenchContextPayload) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, context: WorkbenchContextPayload) =>
        cb(context)
      ipcRenderer.on('openpi:workbench-context-changed', handler)
      return () => ipcRenderer.removeListener('openpi:workbench-context-changed', handler)
    },
  },

  getChangelog: (): Promise<string | null> => ipcRenderer.invoke(IPC.GET_CHANGELOG),
} as const
