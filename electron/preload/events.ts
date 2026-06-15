import { ipcRenderer } from 'electron'
import type {
  ArtifactUpdate,
  RemoteSessionUpdate,
  SessionError,
  SessionEvent,
  SessionReady,
} from '../../src/lib/ipc'
import { IPC } from '../../src/lib/ipc'

interface RemoteSessionStatusPayload {
  app: string
  status: string
  pid: number
  workspace?: string
  sessionFile?: string | null
}

export const eventsApi = {
  sendPrompt: (text: string): Promise<void> => ipcRenderer.invoke(IPC.SEND_PROMPT, { text }),

  onSessionReady: (cb: (payload: SessionReady) => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: SessionReady) => cb(payload)
    ipcRenderer.on(IPC.SESSION_READY, handler)
    return () => ipcRenderer.removeListener(IPC.SESSION_READY, handler)
  },

  onSessionEvent: (cb: (event: SessionEvent) => void) => {
    const handler = (_: Electron.IpcRendererEvent, event: SessionEvent) => cb(event)
    ipcRenderer.on(IPC.SESSION_EVENT, handler)
    return () => ipcRenderer.removeListener(IPC.SESSION_EVENT, handler)
  },

  onSessionError: (cb: (error: SessionError) => void) => {
    const handler = (_: Electron.IpcRendererEvent, error: SessionError) => cb(error)
    ipcRenderer.on(IPC.SESSION_ERROR, handler)
    return () => ipcRenderer.removeListener(IPC.SESSION_ERROR, handler)
  },

  onSessionIndexUpdated: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on(IPC.SESSION_INDEX_UPDATED, handler)
    return () => ipcRenderer.removeListener(IPC.SESSION_INDEX_UPDATED, handler)
  },

  onRemoteSessionStatus: (cb: (payload: RemoteSessionStatusPayload) => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: RemoteSessionStatusPayload) =>
      cb(payload)
    ipcRenderer.on(IPC.REMOTE_SESSION_STATUS, handler)
    return () => ipcRenderer.removeListener(IPC.REMOTE_SESSION_STATUS, handler)
  },

  onRemoteSessionUpdate: (cb: (payload: RemoteSessionUpdate) => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: RemoteSessionUpdate) => cb(payload)
    ipcRenderer.on(IPC.REMOTE_SESSION_UPDATE, handler)
    return () => ipcRenderer.removeListener(IPC.REMOTE_SESSION_UPDATE, handler)
  },

  onArtifactUpdate: (cb: (payload: ArtifactUpdate) => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: ArtifactUpdate) => cb(payload)
    ipcRenderer.on(IPC.ARTIFACT_UPDATE, handler)
    return () => ipcRenderer.removeListener(IPC.ARTIFACT_UPDATE, handler)
  },

  onFileFindShortcut: (fn: () => void) => {
    const handler = () => fn()
    ipcRenderer.on(IPC.FILE_FIND_SHORTCUT, handler)
    return () => ipcRenderer.removeListener(IPC.FILE_FIND_SHORTCUT, handler)
  },
} as const
