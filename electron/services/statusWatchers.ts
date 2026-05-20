import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app, type BrowserWindow } from 'electron'
import type { RemoteSessionUpdate } from '../../src/lib/ipc'
import { goalUpdateSchema, IPC, planUpdateSchema } from '../../src/lib/ipc'
import type { PiSidecarHost } from '../pi/sidecarHost'
import type { SessionIndexStore } from '../session/sessionIndex'

interface StatusWatcherDeps {
  getMainWindow: () => BrowserWindow | null
  getSessionIndex: () => SessionIndexStore | null
  getPiSidecarHost: () => PiSidecarHost | null
  checkForAppUpdate: () => Promise<unknown>
}

function normalizeRemoteSessionFile(value: unknown, sessionRoot: string): string | null {
  if (typeof value !== 'string' || !value) return null
  const resolved = path.resolve(value)
  const root = path.resolve(sessionRoot)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return null
  return resolved
}

export function startStatusWatchers(deps: StatusWatcherDeps): void {
  const syncFile = path.join(os.homedir(), '.pi', 'agent', '.openpi-sync.json')
  const sessionRoot = path.join(os.homedir(), '.pi', 'agent', 'sessions')
  let remoteRunning = false
  let remoteSessionFile: string | null = null
  let remoteSessionMtime = 0
  let remoteSessionSize = 0
  let remoteSessionReadInFlight = false

  async function emitRemoteSessionUpdate(sessionFile: string, force = false) {
    const sessionIndex = deps.getSessionIndex()
    if (!sessionIndex || remoteSessionReadInFlight) return
    let stats: ReturnType<typeof fs.statSync>
    try {
      stats = fs.statSync(sessionFile)
    } catch {
      return
    }

    if (!force && stats.mtimeMs === remoteSessionMtime && stats.size === remoteSessionSize) return
    remoteSessionMtime = stats.mtimeMs
    remoteSessionSize = stats.size
    remoteSessionReadInFlight = true
    try {
      const page = await sessionIndex.getSessionMessages(sessionFile, { limit: 120 })
      const payload: RemoteSessionUpdate = {
        ...page,
        sessionFile,
        updatedAt: Date.now(),
      }
      deps.getMainWindow()?.webContents.send(IPC.REMOTE_SESSION_UPDATE, payload)
    } finally {
      remoteSessionReadInFlight = false
    }
  }

  async function checkSyncFile() {
    try {
      const raw = fs.readFileSync(syncFile, 'utf-8')
      const data = JSON.parse(raw) as {
        pid?: number
        app?: string
        status?: string
        workspace?: string
        sessionFile?: string | null
        timestamp?: number
      }
      if (data.pid && deps.getPiSidecarHost()?.workerPid === data.pid) {
        if (remoteRunning) {
          deps.getMainWindow()?.webContents.send(IPC.REMOTE_SESSION_STATUS, {
            app: data.app ?? 'openpi',
            status: 'idle',
            pid: data.pid,
            sessionFile: null,
          })
        }
        remoteRunning = false
        remoteSessionFile = null
        remoteSessionMtime = 0
        remoteSessionSize = 0
        return
      }

      const isStale = Boolean(data.timestamp && Date.now() - data.timestamp > 10_000)
      const nextSessionFile = normalizeRemoteSessionFile(data.sessionFile, sessionRoot)

      if (isStale || data.status !== 'running' || !data.pid) {
        if (!isStale && nextSessionFile) await emitRemoteSessionUpdate(nextSessionFile)
        if (remoteRunning) {
          deps.getMainWindow()?.webContents.send(IPC.REMOTE_SESSION_STATUS, {
            app: data.app ?? 'pi-tui',
            status: 'idle',
            pid: data.pid ?? 0,
            sessionFile: nextSessionFile,
          })
        }
        remoteRunning = false
        remoteSessionFile = nextSessionFile
        remoteSessionMtime = 0
        remoteSessionSize = 0
        return
      }

      const sessionFileChanged = remoteSessionFile !== nextSessionFile
      remoteRunning = true
      remoteSessionFile = nextSessionFile
      deps.getMainWindow()?.webContents.send(IPC.REMOTE_SESSION_STATUS, {
        app: data.app ?? 'pi-tui',
        status: 'running',
        pid: data.pid,
        workspace: data.workspace,
        sessionFile: nextSessionFile,
      })

      if (nextSessionFile) await emitRemoteSessionUpdate(nextSessionFile, sessionFileChanged)
    } catch {
      // file doesn't exist yet or parse error — ignore
    }
  }

  const syncWatchTimer = setInterval(() => {
    void checkSyncFile()
  }, 1_000)
  setTimeout(() => {
    void checkSyncFile()
  }, 500)

  const goalFile = path.join(os.homedir(), '.pi', 'agent', '.openpi-goal.json')
  let lastGoalChecksum = ''

  function checkGoalFile() {
    try {
      const raw = fs.readFileSync(goalFile, 'utf-8')
      if (raw === lastGoalChecksum) return
      lastGoalChecksum = raw
      deps
        .getMainWindow()
        ?.webContents.send(IPC.GOAL_UPDATE, goalUpdateSchema.parse(JSON.parse(raw)))
    } catch {
      // file doesn't exist or parse error — ignore
    }
  }

  const goalWatchTimer = setInterval(checkGoalFile, 1_000)
  setTimeout(checkGoalFile, 600)

  const planFile = path.join(os.homedir(), '.pi', 'agent', '.openpi-plan.json')
  let lastPlanChecksum = ''

  function checkPlanFile() {
    try {
      const raw = fs.readFileSync(planFile, 'utf-8')
      if (raw === lastPlanChecksum) return
      lastPlanChecksum = raw
      deps
        .getMainWindow()
        ?.webContents.send(IPC.PLAN_UPDATE, planUpdateSchema.parse(JSON.parse(raw)))
    } catch {
      // file doesn't exist or parse error — ignore
    }
  }

  const planWatchTimer = setInterval(checkPlanFile, 1_000)
  setTimeout(checkPlanFile, 650)

  app.on('quit', () => {
    clearInterval(syncWatchTimer)
    clearInterval(goalWatchTimer)
    clearInterval(planWatchTimer)
    remoteRunning = false
    remoteSessionFile = null
  })

  setTimeout(() => {
    void deps.checkForAppUpdate().catch(() => {
      /* silently ignore network errors on startup */
    })
  }, 3000)
}
