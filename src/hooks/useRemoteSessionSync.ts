import { createSignal } from 'solid-js'
import type { RemoteSessionUpdate } from '../lib/ipc'

interface RemoteSessionStatus {
  app: string
  status: string
  pid: number
  workspace?: string
  sessionFile?: string | null
}

interface UseRemoteSessionSyncOptions {
  isStreaming: () => boolean
  isReady: () => boolean
  setError: (message: string | null) => void
}

export function useRemoteSessionSync(_options: UseRemoteSessionSyncOptions) {
  const [remoteSessionStatus, setRemoteSessionStatus] = createSignal<RemoteSessionStatus | null>(
    null
  )
  const [remoteSessionUpdate, setRemoteSessionUpdate] = createSignal<RemoteSessionUpdate | null>(
    null
  )
  const [localActivityAt, setLocalActivityAt] = createSignal(0)

  const markLocalActivity = () => {
    setLocalActivityAt(Date.now())
    setRemoteSessionStatus(null)
    setRemoteSessionUpdate(null)
  }

  const handleRemoteSessionStatus = (payload: RemoteSessionStatus) => {
    setRemoteSessionStatus({
      app: payload.app,
      status: payload.status,
      pid: payload.pid,
      workspace: payload.workspace,
      sessionFile: payload.sessionFile,
    })
    if (payload.status !== 'running' && !payload.sessionFile) setRemoteSessionUpdate(null)
  }

  const handleRemoteSessionUpdate = (payload: RemoteSessionUpdate) => {
    setRemoteSessionUpdate(payload)
  }

  return {
    remoteSessionStatus,
    remoteSessionMessages: () => remoteSessionUpdate()?.messages ?? [],
    remoteSessionUpdatedAt: () => remoteSessionUpdate()?.updatedAt ?? 0,
    localActivityAt,
    markLocalActivity,
    handleRemoteSessionStatus,
    handleRemoteSessionUpdate,
  }
}
