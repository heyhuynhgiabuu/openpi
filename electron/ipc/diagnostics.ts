import path from 'node:path'
import { app, type IpcMain } from 'electron'
import type { z } from 'zod'
import { diagnosticsBundleSchema, IPC } from '../../src/lib/ipc'
import type * as GitHost from '../git/gitHost'
import type * as CustomizationsHost from '../services/customizations'
import { redactObject } from '../services/secretRedact'
import { getAgentDir, getAppInfo, safeFileStats } from '../services/shellEnv'
import type { SessionState } from '../session/sessionHost'
import type { SessionIndexStore } from '../session/sessionIndex'

interface DiagnosticsIpcDeps {
  ipcMain: IpcMain
  getSessionState: () => SessionState | null
  getDeferredWorkspace: () => string | null
  getSessionIndex: () => SessionIndexStore | null
  getCustomizationsHost: () => Promise<typeof CustomizationsHost>
  getGitHost: () => Promise<typeof GitHost>
  getPiSidecarHost: () => unknown | null
}

function redactDiagnosticPaths<T>(value: T, workspacePath?: string | null): T {
  const replacements = [
    [app.getPath('userData'), '$OPENPI_USER_DATA'],
    [getAgentDir(), '$PI_AGENT_DIR'],
    [workspacePath ?? '', '$WORKSPACE'],
    [app.getPath('home'), '~'],
  ].filter(([from]) => from.length > 0)

  let text = JSON.stringify(redactObject(value), null, 2)
  for (const [from, to] of replacements.sort((a, b) => b[0].length - a[0].length)) {
    text = text.split(from).join(to)
  }
  return JSON.parse(text) as T
}

async function buildDiagnosticsBundle(
  deps: DiagnosticsIpcDeps
): Promise<z.infer<typeof diagnosticsBundleSchema>> {
  const sessionState = deps.getSessionState()
  const cwd = sessionState?.cwd ?? deps.getDeferredWorkspace() ?? null
  const dbPath = path.join(app.getPath('userData'), 'openpi.sqlite')
  const notes = [
    'Secrets and sensitive paths are redacted in Electron main before this bundle reaches the renderer.',
    'Pi AuthStorage-owned provider credentials are not read or exported by OpenPi.',
  ]

  let resources: Record<string, unknown> | null = null
  try {
    if (cwd) {
      const { discoverCustomizations } = await deps.getCustomizationsHost()
      resources = await discoverCustomizations({
        cwd,
        agentDir: getAgentDir(),
        workspaceTrusted: deps.getSessionIndex()?.isWorkspaceTrusted(cwd) ?? false,
      })
    }
  } catch (err) {
    resources = { error: err instanceof Error ? err.message : String(err) }
  }

  let git: Record<string, unknown> | null = null
  try {
    if (cwd) {
      const gitHost = await deps.getGitHost()
      git = await gitHost.getGitStatus(cwd)
    }
  } catch (err) {
    git = { error: err instanceof Error ? err.message : String(err) }
  }

  const bundle = diagnosticsBundleSchema.parse({
    generatedAt: new Date().toISOString(),
    app: getAppInfo(),
    runtime: {
      electron: process.versions.electron,
      node: process.versions.node,
      chrome: process.versions.chrome,
      platform: process.platform,
      arch: process.arch,
      isPackaged: app.isPackaged,
    },
    workspace: {
      cwd,
      deferredWorkspace: deps.getDeferredWorkspace(),
      activeSessionFile: sessionState?.sessionFile ?? null,
      activeSessionId: sessionState?.sessionId ?? null,
      trusted: cwd ? (deps.getSessionIndex()?.isWorkspaceTrusted(cwd) ?? false) : false,
    },
    sidecar: {
      hostCreated: deps.getPiSidecarHost() !== null,
      activeSession: sessionState !== null,
    },
    resources,
    git,
    database: {
      main: safeFileStats(dbPath),
      wal: safeFileStats(`${dbPath}-wal`),
      shm: safeFileStats(`${dbPath}-shm`),
    },
    notes,
  })

  return diagnosticsBundleSchema.parse(redactDiagnosticPaths(bundle, cwd))
}

export function registerDiagnosticsIpc(deps: DiagnosticsIpcDeps): void {
  deps.ipcMain.handle(
    IPC.GET_DIAGNOSTICS_BUNDLE,
    async (): Promise<z.infer<typeof diagnosticsBundleSchema>> => buildDiagnosticsBundle(deps)
  )
}
