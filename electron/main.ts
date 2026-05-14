import { execFile, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { app, BrowserWindow, dialog, ipcMain, Notification, net, protocol, shell } from 'electron'
import { z } from 'zod'
import type {
  AppInfo,
  AppUpdateStatus,
  ArchivedSessionItem,
  ArchiveSessionsResult,
  BashExecutionResult,
  CustomizationsInventory,
  CustomProviderInfo,
  FffFileResult,
  FffGrepMatch,
  FileContent,
  FileContentHit,
  GitBranchInfo,
  GitCheckoutBranchResult,
  GitFileDiff,
  GitHistoryResult,
  GitRefsResult,
  GitStatusResult,
  GitSyncResult,
  ModelInfo,
  OutputLine,
  PackageOperationResult,
  PiSettings,
  PiUpdateCheckResult,
  PiUpdateInstallResult,
  PromptTemplate,
  ProviderInfo,
  SessionHistoryPage,
  SessionListItem,
  SessionReady,
  SessionStats,
  SettingsResult,
  SkillItem,
  WorkspaceInfo,
  WorkspaceSummaryInfo,
  WorkspaceTrustResult,
} from '../src/lib/ipc'
import {
  appInfoSchema,
  appUpdateStatusSchema,
  archiveSessionsRequestSchema,
  customizationsInventorySchema,
  customProviderSchema,
  diagnosticsBundleSchema,
  fffFileSearchRequestSchema,
  fffGrepRequestSchema,
  fileTreeResultSchema,
  forkSessionSchema,
  getPrefSchema,
  gitBranchSchema,
  gitCheckoutBranchResultSchema,
  gitCheckoutBranchSchema,
  gitCommitSchema,
  gitDiffRequestSchema,
  gitDiscardSchema,
  gitHistoryRequestSchema,
  gitHistoryResultSchema,
  gitRefsResultSchema,
  gitStageSchema,
  gitSyncResultSchema,
  gitSyncSchema,
  gitUnstageSchema,
  IPC,
  loginProviderSchema,
  logoutProviderSchema,
  newSessionSchema,
  openSessionSchema,
  packageOperationRequestSchema,
  packageOperationResultSchema,
  pathProtectionRequestSchema,
  pathProtectionResultSchema,
  piUpdateCheckResultSchema,
  piUpdateInstallResultSchema,
  playSoundEffectSchema,
  ptyCloseSchema,
  ptyCreateSchema,
  ptyResizeSchema,
  ptyWriteSchema,
  readFileRequestSchema,
  readSkillFileRequestSchema,
  removeCustomProviderSchema,
  removeProviderKeySchema,
  resolveProviderPromptSchema,
  saveSettingsSchema,
  searchFileContentsRequestSchema,
  sessionBashSchema,
  sessionListOptionsSchema,
  sessionMessagesRequestSchema,
  sessionPromptSchema,
  setModelSchema,
  setPrefSchema,
  setProviderKeySchema,
  setSessionNameSchema,
  setThinkingSchema,
  unarchiveSessionsRequestSchema,
  workspaceSummaryInfoSchema,
  workspaceSummaryRequestSchema,
  workspaceTrustRequestSchema,
  workspaceTrustResultSchema,
  writeFileRequestSchema,
} from '../src/lib/ipc'
import {
  NOTIFICATION_PREFERENCES,
  type NotificationPreferenceKey,
  notificationStorageKey,
} from '../src/lib/notificationPreferences'
import {
  SOUND_PREFERENCES,
  type SoundEffectId,
  type SoundPreferenceKey,
  sanitizeSoundEffect,
  soundStorageKey,
} from '../src/lib/soundPreferences'
import type * as CustomizationsHost from './customizations'
import type * as FffHost from './fffHost'
import type * as GitHost from './gitHost'
import type { SidecarMessage } from './piSidecar'
import { PiSidecarHost } from './piSidecarHost'
import type { PtyHost } from './ptyHost'

type PtyHostInstance = InstanceType<typeof PtyHost>

import { checkProtectedPath, filterBlockedPaths } from './protectedPaths'
import { redactObject } from './secretRedact'
import { SessionIndexStore } from './sessionIndex'
import { getSettings, saveSettings as writeSettings } from './settingsHost'
import { checkForAppUpdate, openReleasePage, readChangelog } from './updater'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const execFileAsync = promisify(execFile)

// ── Login-shell PATH enrichment ──────────────────────────────────────────────
// macOS GUI apps launched from Finder/Dock receive a stripped PATH
// (/usr/bin:/bin:/usr/sbin:/sbin) that omits nvm, Homebrew, etc.
// We run the user's login shell once at startup to harvest the full PATH
// so subprocesses (npm, git, node) can be found regardless of launch method.
function enrichPathFromLoginShell(): void {
  if (process.platform === 'win32') return
  const shell = process.env.SHELL
  if (!shell) return
  try {
    const result = spawnSync(shell, ['-lc', 'echo $PATH'], {
      encoding: 'utf-8',
      timeout: 3000,
      env: {
        HOME: process.env.HOME ?? os.homedir(),
        // TERM=dumb prevents colour/prompt codes in login scripts
        TERM: 'dumb',
      },
    })
    if (result.status === 0 && result.stdout) {
      const loginPath = result.stdout.trim()
      if (loginPath) {
        const merged = new Set(loginPath.split(':').filter(Boolean))
        for (const p of (process.env.PATH ?? '').split(':').filter(Boolean)) {
          merged.add(p)
        }
        process.env.PATH = [...merged].join(':')
      }
    }
  } catch {
    // Best-effort — silently continue if the shell does not respond in time
  }
}

enrichPathFromLoginShell()

app.setName('OpenPi')
app.setAppUserModelId('dev.openpi.app')

function resolveAppAssetPath(...segments: string[]): string {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, ...segments)]
    : [path.resolve(currentDir, '../..', ...segments), path.resolve(process.cwd(), ...segments)]
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0]
}

function appIconPath(): string {
  if (process.platform === 'win32') return resolveAppAssetPath('icons', 'icon.ico')
  if (process.platform === 'darwin') return resolveAppAssetPath('icons', 'icon.icns')
  return resolveAppAssetPath('icons', 'icon.png')
}

function dockIconPath(): string {
  return resolveAppAssetPath('icons', 'icon.png')
}

function releaseChannelFor(version: string): string | null {
  const explicit = process.env.OPENPI_RELEASE_CHANNEL?.trim()
  if (explicit) return explicit
  const prerelease = version.match(/^[^-]+-([0-9A-Za-z.-]+)/)?.[1]?.split('.')[0]
  return prerelease ?? 'beta'
}

function getAppInfo(): AppInfo {
  const version = app.getVersion()
  return appInfoSchema.parse({
    name: app.getName() || 'OpenPi',
    version,
    releaseChannel: releaseChannelFor(version),
  })
}

function safeFileStats(filePath: string): Record<string, unknown> {
  try {
    const stats = fs.statSync(filePath)
    return {
      exists: true,
      path: filePath,
      size: stats.size,
      modifiedAt: stats.mtime.toISOString(),
    }
  } catch {
    return { exists: false, path: filePath }
  }
}

const HIGH_RISK_COMMAND_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\brm\s+(-[^\s]*[rf][^\s]*|--recursive|--force)/,
    reason: 'recursive/forced file deletion',
  },
  { pattern: /\bgit\s+reset\s+--hard\b/, reason: 'Git hard reset discards local changes' },
  { pattern: /\bgit\s+clean\s+-[^\s]*[fd]/, reason: 'Git clean deletes untracked files' },
  {
    pattern: /\bgit\s+push\b[^\n]*\s(--force|-f|--force-with-lease)\b/,
    reason: 'force-push rewrites remote history',
  },
  { pattern: /\bgit\s+rebase\s+--abort\b/, reason: 'rebase abort rewrites the working tree state' },
  {
    pattern: /\b(?:sudo\s+)?(?:dd|mkfs|diskutil|fdisk)\b/,
    reason: 'disk-level command can destroy data',
  },
  { pattern: /\bchmod\s+-R\s+777\b/, reason: 'recursive world-writable permission change' },
  { pattern: /\bchown\s+-R\b/, reason: 'recursive ownership change' },
]

function highRiskShellReason(command: string): string | null {
  const normalized = command.replace(/\\\n/g, '\n')
  for (const { pattern, reason } of HIGH_RISK_COMMAND_PATTERNS) {
    if (pattern.test(normalized)) return reason
  }
  return null
}

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

async function buildDiagnosticsBundle(): Promise<z.infer<typeof diagnosticsBundleSchema>> {
  const cwd = state?.cwd ?? deferredWorkspace ?? null
  const dbPath = path.join(app.getPath('userData'), 'openpi.sqlite')
  const notes = [
    'Secrets and sensitive paths are redacted in Electron main before this bundle reaches the renderer.',
    'Pi AuthStorage-owned provider credentials are not read or exported by OpenPi.',
  ]

  let resources: Record<string, unknown> | null = null
  try {
    if (cwd) {
      const { discoverCustomizations } = await getCustomizationsHost()
      resources = await discoverCustomizations({
        cwd,
        agentDir: getAgentDir(),
        workspaceTrusted: sessionIndex?.isWorkspaceTrusted(cwd) ?? false,
      })
    }
  } catch (err) {
    resources = { error: err instanceof Error ? err.message : String(err) }
  }

  let git: Record<string, unknown> | null = null
  try {
    if (cwd) {
      const gitHost = await getGitHost()
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
      deferredWorkspace,
      activeSessionFile: state?.sessionFile ?? null,
      activeSessionId: state?.sessionId ?? null,
      trusted: cwd ? (sessionIndex?.isWorkspaceTrusted(cwd) ?? false) : false,
    },
    sidecar: {
      hostCreated: piSidecarHost !== null,
      activeSession: state !== null,
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

function getAgentDir(): string {
  return path.join(app.getPath('home'), '.pi', 'agent')
}

// ─── Session state ─────────────────────────────────────────────────────────────

type SessionState = {
  cwd: string
  sessionFile: string | null
  sessionId: string | null
}

type StartSessionOptions = {
  sessionFile?: string
  /** Entry ID to fork from. When set, opens the session positioned at this entry. */
  forkEntryId?: string
}

let state: SessionState | null = null
let deferredWorkspace: string | null = null
let mainWindow: BrowserWindow | null = null
let sessionIndex: SessionIndexStore | null = null
let refreshInFlight: Promise<void> | null = null
let fffHostPromise: Promise<typeof FffHost> | null = null
let customizationsHostPromise: Promise<typeof CustomizationsHost> | null = null
let piSidecarHost: PiSidecarHost | null = null

function createRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function requirePiSidecar(): PiSidecarHost {
  return ensurePiSidecarStarted()
}

async function getCustomizationsHost(): Promise<typeof CustomizationsHost> {
  customizationsHostPromise ??= import('./customizations')
  return customizationsHostPromise
}

async function getFffHost(): Promise<typeof FffHost> {
  fffHostPromise ??= import('./fffHost')
  return fffHostPromise
}

async function ensureFffInitialized(cwd: string): Promise<typeof FffHost | null> {
  const workspacePath = resolveFffCwd(cwd)
  if (!workspacePath) return null
  const host = await getFffHost()
  // Always delegate to initFff — it is idempotent via its own guard:
  //   if (currentCwd === cwd && finder) return  // no-op when already healthy
  // Using fffInitializedCwd here was a premature optimisation that caused a
  // silent failure: if FileFinder.create() failed (e.g. quarantined binary,
  // permission error), finder stayed null but fffInitializedCwd was still set
  // to cwd, so subsequent calls skipped initFff and permanently returned [].
  await host.initFff(workspacePath)
  return host
}

function resolveFffCwd(cwd: string): string | null {
  if (!path.isAbsolute(cwd)) return null
  try {
    return fs.statSync(cwd).isDirectory() ? path.resolve(cwd) : null
  } catch {
    return null
  }
}

let gitHostPromise: Promise<typeof GitHost> | null = null
async function getGitHost(): Promise<typeof GitHost> {
  gitHostPromise ??= import('./gitHost')
  return gitHostPromise
}

/**
 * (Re)start git status polling and file-tree watching for a workspace.
 *
 * Called from two places:
 *  1. GIT_PANEL_MOUNTED — first paint after app launch.
 *  2. session_ready    — every workspace/session switch.
 *
 * The GitPanel component never unmounts, so GIT_PANEL_MOUNTED fires only
 * once per app lifetime. Without point (2), switching workspaces stops the
 * poll (via stopGitPoll inside startSession) and never restarts it, leaving
 * the panel showing stale data from the previous workspace.
 */
async function restartGitMonitoring(cwd: string): Promise<void> {
  const git = await getGitHost()
  git.startGitPoll(cwd, (status: GitStatusResult) => {
    mainWindow?.webContents.send(IPC.GIT_STATUS_CHANGED, status)
  })
  git.startFileTreeWatch(cwd, () => {
    mainWindow?.webContents.send(IPC.FILE_TREE_CHANGED)
  })
}

let ptyHostPromise: Promise<PtyHostInstance> | null = null
async function getPtyHost(): Promise<PtyHostInstance> {
  ptyHostPromise ??= import('./ptyHost').then((m) => m.ptyHost)
  return ptyHostPromise
}

function getBundledPiVersion(): string {
  try {
    const entryPath = require.resolve('@earendil-works/pi-coding-agent')
    const packageJsonPath = path.resolve(path.dirname(entryPath), '..', 'package.json')
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as {
      version?: unknown
    }
    return typeof packageJson.version === 'string' ? packageJson.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

function compareSemver(a: string, b: string): number {
  const parse = (version: string) =>
    version
      .split('-')[0]
      ?.split('.')
      .map((part) => Number(part) || 0) ?? []
  const left = parse(a)
  const right = parse(b)
  for (let i = 0; i < Math.max(left.length, right.length, 3); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

async function checkPiUpdate(): Promise<PiUpdateCheckResult> {
  const currentVersion = getBundledPiVersion()
  const checkedAt = new Date().toISOString()

  try {
    const response = await fetch('https://pi.dev/api/latest-version', {
      headers: { 'user-agent': `openpi/${app.getVersion()} pi/${currentVersion}` },
    })
    if (!response.ok) throw new Error(`latest-version returned HTTP ${response.status}`)

    const data = (await response.json()) as {
      ok?: unknown
      version?: unknown
      packageName?: unknown
    }
    const latestVersion = typeof data.version === 'string' ? data.version : null
    const packageName =
      typeof data.packageName === 'string' ? data.packageName : '@earendil-works/pi-coding-agent'

    return piUpdateCheckResultSchema.parse({
      currentVersion,
      latestVersion,
      packageName,
      updateAvailable: latestVersion != null && compareSemver(latestVersion, currentVersion) > 0,
      checkedAt,
      error: latestVersion ? null : 'Latest version response did not include a version.',
    })
  } catch (err) {
    return piUpdateCheckResultSchema.parse({
      currentVersion,
      latestVersion: null,
      packageName: null,
      updateAvailable: false,
      checkedAt,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

async function installPiUpdate(): Promise<PiUpdateInstallResult> {
  const command = process.platform === 'win32' ? 'pi.cmd' : 'pi'
  try {
    const { stdout, stderr } = await execFileAsync(command, ['update', '--self'], {
      timeout: 5 * 60 * 1000,
      maxBuffer: 1024 * 1024,
    })
    return piUpdateInstallResultSchema.parse({ ok: true, output: `${stdout}${stderr}`.trim() })
  } catch (err) {
    const error = err as { code?: unknown; stdout?: unknown; stderr?: unknown; message?: unknown }
    const output = [error.stdout, error.stderr, error.message]
      .filter((part): part is string => typeof part === 'string' && part.length > 0)
      .join('\n')
    const missingCliMessage =
      'Pi CLI executable was not found on PATH. OpenPi package install/remove uses the bundled Pi SDK, but self-update requires the standalone `pi` CLI. Install it or expose it on PATH, then run `pi update --self`.'
    return piUpdateInstallResultSchema.parse({
      ok: false,
      output: error.code === 'ENOENT' ? missingCliMessage : output || 'pi update --self failed.',
    })
  }
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
    mainWindow?.webContents.send(IPC.OUTPUT_APPEND, line)
  }
}

function soundEffectPattern(effect: SoundEffectId): number[] {
  if (effect === 'none') return []

  const match = /^(alert|bip-bop|staplebops|nope|yup)-(\d+)$/.exec(effect)
  if (!match) return []

  const family = match[1]
  const variant = Number(match[2] ?? 1)
  const offset = (variant % 4) * 20

  switch (family) {
    case 'alert':
      return variant % 3 === 0 ? [0, 180 + offset] : [0]
    case 'bip-bop':
      return [0, 110 + offset]
    case 'staplebops':
      return Array.from({ length: Math.min(variant + 1, 5) }, (_, index) => index * (70 + offset))
    case 'nope':
      return variant % 2 === 0 ? [0, 90 + offset, 360 + offset] : [0, 260 + offset]
    case 'yup':
      return variant % 2 === 0 ? [0, 140 + offset] : [0]
    default:
      return []
  }
}

function notificationPref(key: NotificationPreferenceKey): boolean {
  const meta = NOTIFICATION_PREFERENCES.find((item) => item.key === key)
  const raw = sessionIndex?.getPref(notificationStorageKey(key))
  if (raw == null || raw === '') return meta?.defaultValue ?? false
  return raw === 'true'
}

function selectedSoundEffect(key: SoundPreferenceKey): SoundEffectId {
  const meta = SOUND_PREFERENCES.find((item) => item.key === key)
  const raw = sessionIndex?.getPref(soundStorageKey(key))
  if (raw == null || raw === '') return meta?.defaultValue ?? 'none'
  return sanitizeSoundEffect(raw)
}

function notificationBody(text: string): string {
  return text.length > 180 ? `${text.slice(0, 177)}…` : text
}

function showSystemNotification(key: NotificationPreferenceKey, title: string, body: string): void {
  if (!notificationPref(key)) return
  if (!Notification.isSupported()) return
  if (mainWindow?.isFocused()) return
  new Notification({ title, body: notificationBody(body) }).show()
}

function playSoundEffectId(effect: SoundEffectId): void {
  for (const delayMs of soundEffectPattern(effect)) {
    setTimeout(() => shell.beep(), delayMs)
  }
}

function playSoundEffect(key: SoundPreferenceKey): void {
  playSoundEffectId(selectedSoundEffect(key))
}

function emitSessionError(message: string, code?: string): void {
  mainWindow?.webContents.send(IPC.SESSION_ERROR, {
    message,
    ...(code ? { code } : {}),
  })
  showSystemNotification('notifyErrors', 'OpenPi error', message)
  playSoundEffect('soundErrors')
}

// ─── Session host ──────────────────────────────────────────────────────────────

function handleSidecarMessage(msg: SidecarMessage): void {
  switch (msg.type) {
    case 'ready':
    case 'stopped':
      return

    case 'session_ready': {
      const ready = normalizeSessionReady(msg.payload)
      state = {
        cwd: ready.cwd,
        sessionFile: ready.sessionFile,
        sessionId: ready.sessionId,
      }
      deferredWorkspace = null
      mainWindow?.webContents.send(IPC.SESSION_READY, ready)
      // Restart git monitoring for the new workspace. The GitPanel never
      // unmounts, so GIT_PANEL_MOUNTED fires only once at app start. On every
      // subsequent workspace/session switch startSession() calls stopGitPoll(),
      // but the mount event never re-fires — leaving the panel stale.
      // Restarting here guarantees the poll always tracks the current cwd.
      void restartGitMonitoring(ready.cwd)
      return
    }

    case 'session_event': {
      const event = msg.event as {
        type?: string
        success?: boolean
        finalError?: string
        errorMessage?: string
        message?: string
      }
      mainWindow?.webContents.send(IPC.SESSION_EVENT, msg.event)

      if (event.type === 'agent_end') {
        setTimeout(() => {
          void refreshSessionIndex()
        }, 0)
        const cwd = state?.cwd ?? deferredWorkspace ?? ''
        showSystemNotification(
          'notifyAgentStatus',
          'Agent complete',
          `OpenPi finished working${cwd ? ` in ${path.basename(cwd)}` : ''}.`
        )
        playSoundEffect('soundAgentStatus')
        // Notify renderer if agent left uncommitted changes behind
        if (cwd) {
          void getGitHost().then(async (git) => {
            try {
              const status = await git.getGitStatus(cwd)
              const changed = status?.files.length ?? 0
              if (changed > 0) {
                mainWindow?.webContents.send(IPC.AGENT_CHANGED_FILES, { count: changed })
              }
            } catch {
              // non-fatal — git may not be available in all workspaces
            }
          })
        }
      }

      if (event.type === 'extension_error') {
        const message = String(event.message ?? 'extension error')
        showSystemNotification('notifyErrors', 'OpenPi error', message)
        playSoundEffect('soundErrors')
      }

      if (event.type === 'auto_retry_end' && event.success === false) {
        showSystemNotification(
          'notifyAgentStatus',
          'Agent needs attention',
          event.finalError ?? 'Auto-retry failed.'
        )
        playSoundEffect('soundAgentStatus')
      }

      if (event.type === 'compaction_end' && event.errorMessage) {
        showSystemNotification('notifyErrors', 'OpenPi error', event.errorMessage)
        playSoundEffect('soundErrors')
      }
      return
    }

    case 'session_error':
      emitSessionError(msg.message, msg.code)
      return

    case 'session_index_updated':
      void refreshSessionIndex()
      return

    case 'provider_login_event': {
      const event = msg.event as { type?: string; url?: string }
      if (event.type === 'auth' && typeof event.url === 'string') {
        void shell.openExternal(event.url)
      }
      mainWindow?.webContents.send(IPC.PROVIDER_LOGIN_EVENT, msg.event)
      return
    }

    case 'output_append':
      mainWindow?.webContents.send(IPC.OUTPUT_APPEND, msg.line)
      return

    case 'error':
      emitSessionError(msg.message)
      return

    default:
      return
  }
}

function normalizeSessionReady(payload: SessionReady): SessionReady {
  return {
    ...payload,
    sessionName: payload.sessionFile
      ? (sessionIndex?.getSessionTitle(payload.sessionFile) ?? payload.sessionName ?? null)
      : (payload.sessionName ?? null),
  }
}

function ensurePiSidecarStarted(): PiSidecarHost {
  if (!piSidecarHost) {
    piSidecarHost = new PiSidecarHost({
      onMessage: handleSidecarMessage,
      onCrash: () => emitSessionError('Pi sidecar crashed repeatedly.', 'pi_sidecar_crashed'),
    })
    piSidecarHost.start()
  }
  return piSidecarHost
}

async function startSession(cwd: string, options: StartSessionOptions = {}): Promise<void> {
  deferredWorkspace = null
  const workspacePath = sessionIndex?.upsertWorkspace(cwd) ?? cwd

  state = null
  if (gitHostPromise)
    void getGitHost().then((host) => {
      host.stopFileTreeWatch()
      host.stopGitPoll()
    })
  if (fffHostPromise) {
    void getFffHost().then((host) => host.destroyFff())
  }

  const requestId = createRequestId()
  const response = await ensurePiSidecarStarted().request<
    Extract<SidecarMessage, { type: 'session_ready' }>
  >({
    type: 'start_session',
    requestId,
    cwd: workspacePath,
    workspaceTrusted: sessionIndex?.isWorkspaceTrusted(workspacePath) ?? false,
    sessionFile: options.sessionFile,
    forkEntryId: options.forkEntryId,
  })

  const ready = normalizeSessionReady(response.payload as SessionReady)
  state = {
    cwd: ready.cwd,
    sessionFile: ready.sessionFile,
    sessionId: ready.sessionId,
  }

  mainWindow?.webContents.send(IPC.SESSION_READY, ready)
  void maybeCheckPiUpdateOnStartup().catch((err) => {
    const line: OutputLine = {
      level: 'warn',
      text: `[updates] ${err instanceof Error ? err.message : String(err)}`,
      ts: Date.now(),
    }
    mainWindow?.webContents.send(IPC.OUTPUT_APPEND, line)
  })
  await refreshSessionIndex()
}

async function ensureActiveSession(): Promise<SessionState | null> {
  if (state) return state
  if (!deferredWorkspace) return null
  await startSession(deferredWorkspace)
  return state
}

function activeWorkspacePath(): string | null {
  return state?.cwd ?? deferredWorkspace ?? null
}

function showDeferredWorkspace(cwd: string): void {
  const workspacePath = sessionIndex?.upsertWorkspace(cwd) ?? cwd
  deferredWorkspace = workspacePath
  const ready: SessionReady = {
    cwd: workspacePath,
    sessionFile: null,
    sessionId: null,
    sessionName: null,
    model: null,
    thinkingLevel: null,
  }
  mainWindow?.webContents.send(IPC.SESSION_READY, ready)
  void refreshSessionIndex()
  void maybeCheckPiUpdateOnStartup().catch((err) => {
    const line: OutputLine = {
      level: 'warn',
      text: `[updates] ${err instanceof Error ? err.message : String(err)}`,
      ts: Date.now(),
    }
    mainWindow?.webContents.send(IPC.OUTPUT_APPEND, line)
  })
}

async function refreshSessionIndex(): Promise<void> {
  if (!sessionIndex) return
  if (refreshInFlight) return refreshInFlight

  refreshInFlight = (async () => {
    try {
      // Scope refresh to current/deferred workspace — never scan every Pi
      // workspace just because no agent session has been started yet.
      const workspacePath = activeWorkspacePath()
      if (!workspacePath) {
        mainWindow?.webContents.send(IPC.SESSION_INDEX_UPDATED)
        return
      }
      await sessionIndex?.refreshSessions(state?.sessionFile ?? null, workspacePath)
      mainWindow?.webContents.send(IPC.SESSION_INDEX_UPDATED)
    } catch (err) {
      emitSessionError(
        err instanceof Error ? err.message : String(err),
        'session_index_refresh_failed'
      )
    } finally {
      refreshInFlight = null
    }
  })()

  return refreshInFlight
}

// ─── Custom provider helpers (models.json) ────────────────────────────────────

type ModelsJsonProviderEntry = {
  name?: string
  baseUrl: string
  api?: string
  apiKey?: string
  headers?: Record<string, string>
  /** May be absent for provider-override entries (baseUrl/headers only, no models list) */
  models?: Array<{ id: string; name?: string }>
}

type ModelsJson = {
  providers?: Record<string, ModelsJsonProviderEntry>
}

function readModelsJson(agentDir: string): ModelsJson {
  const modelsPath = path.join(agentDir, 'models.json')
  try {
    return JSON.parse(fs.readFileSync(modelsPath, 'utf-8')) as ModelsJson
  } catch {
    return {}
  }
}

function writeModelsJson(agentDir: string, data: ModelsJson): void {
  const modelsPath = path.join(agentDir, 'models.json')
  fs.mkdirSync(agentDir, { recursive: true })
  fs.writeFileSync(modelsPath, JSON.stringify(data, null, 2), 'utf-8')
}

// ─── IPC handlers ──────────────────────────────────────────────────────────────

function registerHandlers(): void {
  ipcMain.handle(IPC.GET_APP_INFO, async (): Promise<AppInfo> => getAppInfo())

  ipcMain.handle(IPC.PICK_WORKSPACE, async () => {
    if (!mainWindow) return { cancelled: true }
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Open Workspace',
      properties: ['openDirectory'],
      buttonLabel: 'Open Workspace',
    })
    if (result.canceled || !result.filePaths[0]) {
      return { cancelled: true }
    }
    const workspacePath = result.filePaths[0]
    try {
      await startSession(workspacePath)
    } catch (err) {
      emitSessionError(err instanceof Error ? err.message : String(err))
    }
    return { cancelled: false, path: workspacePath }
  })

  ipcMain.handle(IPC.SESSION_PROMPT, async (_event, raw: unknown) => {
    const active = await ensureActiveSession()
    if (!active) return
    const { text } = sessionPromptSchema.parse(raw)
    requirePiSidecar().send({ type: 'prompt', text })
  })

  ipcMain.handle(IPC.SESSION_STEER, async (_event, raw: unknown) => {
    const active = await ensureActiveSession()
    if (!active) return
    const { text } = sessionPromptSchema.parse(raw)
    requirePiSidecar().send({ type: 'steer', text })
  })

  ipcMain.handle(IPC.SESSION_FOLLOW_UP, async (_event, raw: unknown) => {
    const active = await ensureActiveSession()
    if (!active) return
    const { text } = sessionPromptSchema.parse(raw)
    requirePiSidecar().send({ type: 'follow_up', text })
  })

  ipcMain.handle(
    IPC.SESSION_BASH,
    async (_event, raw: unknown): Promise<BashExecutionResult | undefined> => {
      const active = await ensureActiveSession()
      if (!active) return undefined
      const { command, excludeFromContext } = sessionBashSchema.parse(raw)
      const riskReason = highRiskShellReason(command)
      if (riskReason) {
        const approved = await confirmHighRiskMutation({
          title: 'Confirm high-risk shell command',
          message: 'This shell command can mutate or delete data.',
          detail: `${riskReason}\n\nCommand:\n${command}`,
        })
        if (!approved) {
          return {
            output: 'Command cancelled by user.',
            exitCode: 130,
            cancelled: true,
            truncated: false,
          }
        }
      }
      const requestId = createRequestId()
      const response = await requirePiSidecar().request<
        Extract<SidecarMessage, { type: 'bash_result' }>
      >({
        type: 'execute_bash',
        requestId,
        command,
        excludeFromContext,
      })
      setTimeout(() => {
        void refreshSessionIndex()
      }, 0)
      return response.result as BashExecutionResult
    }
  )

  ipcMain.handle(IPC.SESSION_ABORT, async () => {
    if (!state) return
    requirePiSidecar().send({ type: 'abort' })
  })

  ipcMain.handle(IPC.GET_MODELS, async (): Promise<ModelInfo[]> => {
    const requestId = createRequestId()
    const response = await requirePiSidecar().request<
      Extract<SidecarMessage, { type: 'models_result' }>
    >({
      type: 'get_models',
      requestId,
    })
    return response.models as ModelInfo[]
  })

  ipcMain.handle(IPC.SET_MODEL, async (_event, raw: unknown) => {
    if (!state) return
    const { provider, modelId } = setModelSchema.parse(raw)
    requirePiSidecar().send({ type: 'set_model', provider, modelId })
  })

  ipcMain.handle(IPC.SET_THINKING, async (_event, raw: unknown) => {
    if (!state) return
    const { level } = setThinkingSchema.parse(raw)
    requirePiSidecar().send({ type: 'set_thinking', level })
  })

  ipcMain.handle(IPC.GET_SESSION_STATS, async (): Promise<SessionStats> => {
    if (!state) {
      return {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cost: 0,
        contextUsagePercent: null,
        sessionFile: null,
        sessionId: null,
        isStreaming: false,
      }
    }
    const requestId = createRequestId()
    const response = await requirePiSidecar().request<
      Extract<SidecarMessage, { type: 'stats_result' }>
    >({
      type: 'get_stats',
      requestId,
    })
    return response.stats as SessionStats
  })

  ipcMain.handle(IPC.GET_WORKSPACES, async (): Promise<WorkspaceInfo[]> => {
    return sessionIndex?.listWorkspaces() ?? []
  })

  ipcMain.handle(IPC.GET_SESSIONS, async (_event, raw: unknown): Promise<SessionListItem[]> => {
    const options = sessionListOptionsSchema.parse(raw)
    // Scope to explicit selected workspace first, then current/deferred workspace.
    // Never fall back to every historical Pi workspace from renderer list calls.
    const workspacePath = options.workspacePath ?? activeWorkspacePath()
    if (!workspacePath) return []
    return sessionIndex?.listSessions(options, state?.sessionFile ?? null, workspacePath) ?? []
  })

  ipcMain.handle(
    IPC.GET_SESSION_MESSAGES,
    async (_event, raw: unknown): Promise<SessionHistoryPage> => {
      const { path: sessionPath, limit, beforeEntryId } = sessionMessagesRequestSchema.parse(raw)
      return (
        (await sessionIndex?.getSessionMessages(sessionPath, { limit, beforeEntryId })) ?? {
          messages: [],
          hasMoreBefore: false,
          nextBeforeEntryId: null,
          limit: limit ?? 0,
        }
      )
    }
  )

  ipcMain.handle(IPC.OPEN_SESSION, async (_event, raw: unknown) => {
    const { path: sessionPath } = openSessionSchema.parse(raw)
    const cwd = sessionIndex?.getSessionWorkspace(sessionPath) ?? state?.cwd
    if (!cwd) return
    await startSession(cwd, { sessionFile: sessionPath })
  })

  ipcMain.handle(IPC.NEW_SESSION, async (_event, raw: unknown) => {
    const { cwd } = newSessionSchema.parse(raw)
    const workspacePath = cwd ?? state?.cwd ?? sessionIndex?.getLastWorkspace()
    if (!workspacePath) return
    await startSession(workspacePath)
  })

  ipcMain.handle(IPC.GET_GIT_BRANCH, async (_event, raw: unknown): Promise<GitBranchInfo> => {
    const { cwd } = gitBranchSchema.parse(raw)
    try {
      const { default: sg } = await import('simple-git')
      const branch = await sg({ baseDir: cwd }).branch()
      return { branch: branch.current || null }
    } catch {
      return { branch: null }
    }
  })

  ipcMain.handle(
    IPC.GET_WORKSPACE_SUMMARY,
    async (_event, raw: unknown): Promise<WorkspaceSummaryInfo> => {
      const { cwd } = workspaceSummaryRequestSchema.parse(raw)
      const git = await getGitHost()
      return workspaceSummaryInfoSchema.parse(await git.getWorkspaceSummary(cwd))
    }
  )

  ipcMain.handle(
    IPC.SET_WORKSPACE_TRUST,
    async (_event, raw: unknown): Promise<WorkspaceTrustResult> => {
      const { cwd, trusted } = workspaceTrustRequestSchema.parse(raw)
      if (!sessionIndex) throw new Error('Session index is not ready')
      if (trusted && !sessionIndex.isWorkspaceTrusted(cwd)) {
        const { discoverCustomizations } = await getCustomizationsHost()
        const inventory = await discoverCustomizations({
          cwd,
          agentDir: getAgentDir(),
          workspaceTrusted: false,
        })
        const projectExtensions = inventory.items.filter(
          (item) => item.type === 'extensions' && item.scope === 'project'
        )
        if (projectExtensions.length > 0) {
          const approved = await confirmHighRiskMutation({
            title: 'Trust workspace extensions?',
            message: 'Confirm workspace trust before enabling executable project resources.',
            detail: `This will allow ${projectExtensions.length} project extension${projectExtensions.length === 1 ? '' : 's'} to run with full Node permissions:\n\n${projectExtensions.map((item) => `• ${item.name}: ${item.path ?? item.source}`).join('\n')}`,
          })
          if (!approved)
            return workspaceTrustResultSchema.parse({ cwd, trusted: false, trustedAt: null })
        }
      }
      return workspaceTrustResultSchema.parse(sessionIndex.setWorkspaceTrust(cwd, trusted))
    }
  )

  ipcMain.handle(
    IPC.CHECK_PATH_PROTECTION,
    (_event, raw: unknown): z.infer<typeof pathProtectionResultSchema> => {
      const { path: targetPath, workspacePath } = pathProtectionRequestSchema.parse(raw)
      const violation = checkProtectedPath(targetPath, workspacePath)
      return pathProtectionResultSchema.parse({
        protected: violation !== null,
        level: violation?.level ?? null,
        rule: violation?.rule ?? null,
        reason: violation?.reason ?? null,
      })
    }
  )

  ipcMain.handle(IPC.GET_CUSTOMIZATIONS, async (): Promise<CustomizationsInventory> => {
    const { discoverCustomizations } = await getCustomizationsHost()
    const cwd = state?.cwd ?? deferredWorkspace
    const inventory = await discoverCustomizations({
      cwd,
      agentDir: getAgentDir(),
      workspaceTrusted: cwd ? (sessionIndex?.isWorkspaceTrusted(cwd) ?? false) : false,
    })
    return customizationsInventorySchema.parse(inventory)
  })

  ipcMain.handle(
    IPC.GET_DIAGNOSTICS_BUNDLE,
    async (): Promise<z.infer<typeof diagnosticsBundleSchema>> => buildDiagnosticsBundle()
  )

  ipcMain.handle(
    IPC.INSTALL_PACKAGE,
    async (_event, raw: unknown): Promise<PackageOperationResult> => {
      const { source, scope } = packageOperationRequestSchema.parse(raw)
      const approved = await confirmHighRiskMutation({
        title: 'Install Pi package?',
        message: 'Confirm Pi package installation',
        detail: `${source} will be installed in ${scope} settings. Pi packages may provide executable extensions with full Node permissions.`,
      })
      if (!approved) {
        return packageOperationResultSchema.parse({
          ok: false,
          output: 'Package installation cancelled.',
        })
      }
      const { installCustomizationPackage } = await getCustomizationsHost()
      return packageOperationResultSchema.parse(
        await installCustomizationPackage({
          cwd: state?.cwd ?? deferredWorkspace,
          agentDir: getAgentDir(),
          source,
          scope,
        })
      )
    }
  )

  ipcMain.handle(
    IPC.REMOVE_PACKAGE,
    async (_event, raw: unknown): Promise<PackageOperationResult> => {
      const { source, scope } = packageOperationRequestSchema.parse(raw)
      const approved = await confirmHighRiskMutation({
        title: 'Confirm Pi package removal',
        message: `Remove ${scope} Pi package?`,
        detail: `${source}\n\nThis mutates Pi ${scope} settings and may remove extension/skill resources from OpenPi.`,
      })
      if (!approved) return packageOperationResultSchema.parse({ ok: false, output: 'Cancelled.' })
      const { removeCustomizationPackage } = await getCustomizationsHost()
      return packageOperationResultSchema.parse(
        await removeCustomizationPackage({
          cwd: state?.cwd ?? deferredWorkspace,
          agentDir: getAgentDir(),
          source,
          scope,
        })
      )
    }
  )

  ipcMain.handle(IPC.SET_SESSION_NAME, (_event, raw: unknown) => {
    if (!state) return
    const { name } = setSessionNameSchema.parse(raw)
    requirePiSidecar().send({ type: 'set_session_name', name })
  })

  ipcMain.handle(IPC.FORK_SESSION, async (_event, raw: unknown) => {
    if (!state) return
    const { entryId } = forkSessionSchema.parse(raw)
    const requestId = createRequestId()
    const response = await requirePiSidecar().request<
      Extract<SidecarMessage, { type: 'session_ready' }>
    >({
      type: 'fork_session',
      requestId,
      entryId,
    })
    const ready = normalizeSessionReady(response.payload as SessionReady)
    state = { cwd: ready.cwd, sessionFile: ready.sessionFile, sessionId: ready.sessionId }
    mainWindow?.webContents.send(IPC.SESSION_READY, ready)
    await refreshSessionIndex()
  })

  // ── PTY handlers ────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.PTY_CREATE, async (_event, raw: unknown): Promise<string> => {
    const { cwd, cols, rows } = ptyCreateSchema.parse(raw)
    return (await getPtyHost()).create(cwd, cols, rows)
  })

  ipcMain.on(IPC.PTY_WRITE, (_event, raw: unknown) => {
    const { id, data } = ptyWriteSchema.parse(raw)
    if (ptyHostPromise) void getPtyHost().then((h) => h.write(id, data))
  })

  ipcMain.on(IPC.PTY_RESIZE, (_event, raw: unknown) => {
    const { id, cols, rows } = ptyResizeSchema.parse(raw)
    if (ptyHostPromise) void getPtyHost().then((h) => h.resize(id, cols, rows))
  })

  ipcMain.on(IPC.PTY_CLOSE, (_event, raw: unknown) => {
    const { id } = ptyCloseSchema.parse(raw)
    if (ptyHostPromise) void getPtyHost().then((h) => h.close(id))
  })

  // ── Preference handlers ──────────────────────────────────────────────────
  ipcMain.handle(IPC.GET_PREF, (_event, raw: unknown): string | null => {
    const { key } = getPrefSchema.parse(raw)
    return sessionIndex?.getPref(key) ?? null
  })

  ipcMain.handle(IPC.SET_PREF, (_event, raw: unknown): void => {
    const { key, value } = setPrefSchema.parse(raw)
    sessionIndex?.setPref(key, value)
  })

  ipcMain.handle(IPC.PLAY_SOUND_EFFECT, (_event, raw: unknown): void => {
    const { sound } = playSoundEffectSchema.parse(raw)
    playSoundEffectId(sanitizeSoundEffect(sound))
  })

  ipcMain.handle(IPC.CHECK_PI_UPDATE, async (): Promise<PiUpdateCheckResult> => {
    return checkPiUpdate()
  })

  ipcMain.handle(IPC.INSTALL_PI_UPDATE, async (): Promise<PiUpdateInstallResult> => {
    return installPiUpdate()
  })

  // ── App self-update handlers ────────────────────────────────────────────────

  ipcMain.handle(IPC.APP_UPDATE_CHECK, async (): Promise<AppUpdateStatus> => {
    const status = appUpdateStatusSchema.parse(await checkForAppUpdate())
    mainWindow?.webContents.send(IPC.APP_UPDATE_STATUS, status)
    return status
  })

  ipcMain.handle(IPC.APP_UPDATE_OPEN_RELEASE, (_e, raw: unknown): void => {
    const { url } = z.object({ url: z.string().url() }).parse(raw)
    openReleasePage(url)
  })

  ipcMain.handle(IPC.GET_CHANGELOG, (): string | null => {
    return readChangelog()
  })

  // ── Git source control handlers ──────────────────────────────────────────────────

  ipcMain.on(IPC.GIT_PANEL_MOUNTED, () => {
    // Panel mounted for the first time. If a session is already active use
    // its cwd; otherwise fall back to the deferred workspace path. The
    // session_ready handler also calls restartGitMonitoring, so normal
    // workspace switches are covered without relying on this event.
    const cwd = state?.cwd ?? deferredWorkspace
    if (!cwd) return
    void restartGitMonitoring(cwd)
  })

  ipcMain.handle(IPC.GIT_STATUS, async (): Promise<GitStatusResult | null> => {
    if (!state?.cwd) return null
    try {
      const git = await getGitHost()
      return await git.getGitStatus(state.cwd)
    } catch {
      return null
    }
  })

  ipcMain.handle(IPC.GIT_DIFF, async (_event, raw: unknown): Promise<GitFileDiff | null> => {
    if (!state?.cwd) return null
    const { path: filePath } = gitDiffRequestSchema.parse(raw)
    const git = await getGitHost()
    return git.getGitFileDiff(state.cwd, filePath)
  })

  ipcMain.handle(IPC.GIT_STAGE, async (_event, raw: unknown): Promise<void> => {
    if (!state?.cwd) return
    const { path: filePath } = gitStageSchema.parse(raw)
    const { blocked } = filterBlockedPaths([filePath])
    if (blocked.length > 0) {
      throw new Error(`Cannot stage protected path: ${blocked[0].violation.reason}`)
    }
    const git = await getGitHost()
    await git.stageFile(state.cwd, filePath)
  })

  ipcMain.handle(IPC.GIT_UNSTAGE, async (_event, raw: unknown): Promise<void> => {
    if (!state?.cwd) return
    const { path: filePath } = gitUnstageSchema.parse(raw)
    const git = await getGitHost()
    await git.unstageFile(state.cwd, filePath)
  })

  ipcMain.handle(IPC.GIT_COMMIT, async (_event, raw: unknown): Promise<void> => {
    if (!state?.cwd) return
    const { paths, message, push, amend, signoff } = gitCommitSchema.parse(raw)
    // Strip hard-blocked paths before commit — belt-and-suspenders in case a
    // staged set contains protected locations that slipped through stage().
    const { allowed: safePaths, blocked: blockedPaths } = filterBlockedPaths(paths)
    if (blockedPaths.length > 0) {
      const labels = blockedPaths.map((b) => path.basename(b.path)).join(', ')
      throw new Error(`Commit blocked: ${labels} matches a protected path policy.`)
    }
    const git = await getGitHost()
    await git.commitFiles(state.cwd, safePaths, message, push, { amend, signoff })
  })

  ipcMain.handle(IPC.GIT_DISCARD, async (_event, raw: unknown): Promise<void> => {
    if (!state?.cwd) return
    const { path: filePath } = gitDiscardSchema.parse(raw)
    const approved = await confirmHighRiskMutation({
      title: 'Discard file changes?',
      message: 'Confirm destructive Git discard',
      detail: `This will discard local changes for:\n\n${filePath}\n\nThis cannot be undone by OpenPi.`,
    })
    if (!approved) return
    const git = await getGitHost()
    await git.discardFile(state.cwd, filePath)
  })

  ipcMain.handle(IPC.GIT_SYNC, async (_event, raw: unknown): Promise<GitSyncResult | null> => {
    if (!state?.cwd) return null
    const { action } = gitSyncSchema.parse(raw)
    const git = await getGitHost()
    const result = await git.syncRemote(state.cwd, action)
    return gitSyncResultSchema.parse(result)
  })

  ipcMain.handle(IPC.GIT_REFS, async (): Promise<GitRefsResult | null> => {
    if (!state?.cwd) return null
    const git = await getGitHost()
    return gitRefsResultSchema.parse(await git.getGitRefs(state.cwd))
  })

  ipcMain.handle(
    IPC.GIT_HISTORY,
    async (_event, raw: unknown): Promise<GitHistoryResult | null> => {
      if (!state?.cwd) return null
      const { query, limit } = gitHistoryRequestSchema.parse(raw)
      const git = await getGitHost()
      return gitHistoryResultSchema.parse(await git.getGitHistory(state.cwd, query, limit))
    }
  )

  ipcMain.handle(
    IPC.GIT_CHECKOUT_BRANCH,
    async (_event, raw: unknown): Promise<GitCheckoutBranchResult | null> => {
      if (!state?.cwd) return null
      const { branch } = gitCheckoutBranchSchema.parse(raw)
      const git = await getGitHost()
      const result = await git.checkoutBranch(state.cwd, branch)
      return gitCheckoutBranchResultSchema.parse(result)
    }
  )

  ipcMain.handle(
    IPC.GIT_FILE_TREE,
    async (): Promise<import('../src/lib/ipc').FileTreeResult | null> => {
      if (!state?.cwd) return null
      const git = await getGitHost()
      const result = git.getFileTree(state.cwd)
      return fileTreeResultSchema.parse(result)
    }
  )

  ipcMain.handle(
    IPC.GIT_GENERATE_COMMIT_MSG,
    async (): Promise<import('../src/lib/ipc').GenerateCommitMessageResult | null> => {
      if (!state?.cwd) return null
      const git = await getGitHost()
      const status = await git.getGitStatus(state.cwd)
      const staged = status?.files.filter((f) => f.staged) ?? []
      const message = git.generateCommitMessage(staged)
      return { message }
    }
  )

  ipcMain.handle(
    IPC.SEARCH_FILE_CONTENTS,
    async (_event, raw: unknown): Promise<FileContentHit[]> => {
      if (!state?.cwd) return []
      const { query, matchCase, wholeWord, useRegex } = searchFileContentsRequestSchema.parse(raw)
      const git = await getGitHost()
      return git.searchFileContents(state.cwd, query, matchCase, wholeWord, useRegex)
    }
  )

  ipcMain.handle(IPC.READ_FILE, (_event, raw: unknown): FileContent | null => {
    if (!state?.cwd) return null
    const { path: relPath } = readFileRequestSchema.parse(raw)
    // Validate path stays inside workspace (no directory traversal)
    const full = path.resolve(state.cwd, relPath)
    const sep = path.sep
    if (full !== state.cwd && !full.startsWith(state.cwd + sep)) return null
    try {
      const raw = fs.readFileSync(full, 'utf-8')
      const size = Buffer.byteLength(raw, 'utf-8')
      const LIMIT = 500_000
      if (size > LIMIT) {
        return { content: `${raw.slice(0, LIMIT)}\n… [file truncated]`, size, truncated: true }
      }
      return { content: raw, size, truncated: false }
    } catch {
      return null
    }
  })

  ipcMain.handle(IPC.WRITE_FILE, async (_event, raw: unknown): Promise<void> => {
    if (!state?.cwd) throw new Error('No active workspace')
    const { path: relPath, content } = writeFileRequestSchema.parse(raw)
    const full = path.resolve(state.cwd, relPath)
    const sep = path.sep
    if (full !== state.cwd && !full.startsWith(state.cwd + sep)) {
      throw new Error('Refusing to write outside workspace')
    }
    const violation = checkProtectedPath(full, state.cwd)
    if (violation?.level === 'hard') {
      throw new Error(`Refusing to write protected path: ${violation.reason}`)
    }
    if (violation) {
      const approved = await confirmHighRiskMutation({
        title: 'Confirm protected file write',
        message: `Write to ${path.basename(full)}?`,
        detail: `${violation.reason}\n\nPath: ${full}`,
      })
      if (!approved) return
    }
    fs.writeFileSync(full, content, 'utf-8')
  })

  // ── Prompt template listing (slash command completions) ────────────────────
  ipcMain.handle(IPC.LIST_PROMPT_TEMPLATES, (): PromptTemplate[] => {
    const agentDir = getAgentDir()
    const dirsToScan = [
      path.join(agentDir, 'prompts'),
      ...(state?.cwd ? [path.join(state.cwd, '.pi', 'prompts')] : []),
    ]
    const results: PromptTemplate[] = []
    const seen = new Set<string>()
    for (const dir of dirsToScan) {
      if (!fs.existsSync(dir)) continue
      let files: string[]
      try {
        files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'))
      } catch {
        continue
      }
      for (const file of files) {
        const name = path.basename(file, '.md')
        if (seen.has(name)) continue
        seen.add(name)
        let description = ''
        let argHint: string | undefined
        try {
          const content = fs.readFileSync(path.join(dir, file), 'utf-8')
          const fmMatch = /^---\n([\s\S]*?)\n---/.exec(content)
          if (fmMatch) {
            const fm = fmMatch[1]
            const descMatch = /^description:\s*(.+)$/m.exec(fm)
            if (descMatch) description = descMatch[1].trim()
            const argMatch = /^argument-hint:\s*(.+)$/m.exec(fm)
            if (argMatch) argHint = argMatch[1].trim().replace(/^"|"$/g, '')
          }
        } catch {
          /* skip unreadable */
        }
        results.push({ name, description, argHint })
      }
    }
    return results.sort((a, b) => a.name.localeCompare(b.name))
  })

  // ── fff file search + content grep ───────────────────────────────────
  ipcMain.handle(IPC.FFF_FILE_SEARCH, async (_e, raw: unknown): Promise<FffFileResult[]> => {
    const { query, pageSize, cwd } = fffFileSearchRequestSchema.parse(raw)
    const host = await ensureFffInitialized(cwd)
    if (!host) return []
    return host.fffFileSearch(query, pageSize)
  })

  ipcMain.handle(IPC.FFF_GREP, async (_e, raw: unknown): Promise<FffGrepMatch[]> => {
    const { query, mode, smartCase, maxMatchesPerFile, timeBudgetMs, cwd } =
      fffGrepRequestSchema.parse(raw)
    const host = await ensureFffInitialized(cwd)
    if (!host) return []
    return host.fffGrep(query, { mode, smartCase, maxMatchesPerFile, timeBudgetMs })
  })

  // ── Settings management ──────────────────────────────────────────────────

  ipcMain.handle(IPC.GET_SETTINGS, (): SettingsResult => {
    return getSettings(getAgentDir(), state?.cwd ?? null)
  })

  ipcMain.handle(IPC.SAVE_SETTINGS, (_event, raw: unknown): void => {
    const { scope, settings } = saveSettingsSchema.parse(raw)
    writeSettings(scope, settings as PiSettings, getAgentDir(), state?.cwd ?? null)
  })

  ipcMain.handle(IPC.OPEN_EXTERNAL, (_event, url: unknown): void => {
    if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
      void shell.openExternal(url)
    }
  })

  ipcMain.handle(
    IPC.ARCHIVE_SESSIONS,
    async (_event, raw: unknown): Promise<ArchiveSessionsResult> => {
      const { paths } = archiveSessionsRequestSchema.parse(raw)
      let archived = 0
      let skipped = 0

      // If any path is the currently active session, start a new session first so
      // the SDK doesn't keep writing to a file we're about to rename.
      const activeFile = state?.sessionFile
      const willArchiveActive = activeFile != null && paths.includes(activeFile)
      if (willArchiveActive && state) {
        try {
          await startSession(state.cwd)
        } catch {
          /* non-fatal */
        }
      }

      for (const filePath of paths) {
        // Only rename .jsonl files (catches plain sessions + the legacy .archived/ dir sessions)
        if (!filePath.endsWith('.jsonl')) {
          skipped++
          continue
        }
        try {
          // Rename to .jsonl.archived — Pi SDK's listAll() only picks up .jsonl,
          // so this hides the file from discovery without moving it out of its directory.
          // Fully reversible: rename back to .jsonl to restore.
          fs.renameSync(filePath, `${filePath}.archived`)
          archived++
        } catch (err) {
          skipped++
          const line: OutputLine = {
            level: 'warn',
            text: `[archive] rename failed: ${String(err)}`,
            ts: Date.now(),
          }
          mainWindow?.webContents.send(IPC.OUTPUT_APPEND, line)
        }
      }

      // Force a completely fresh refresh — reset any in-flight to avoid using
      // stale pre-rename results from a concurrent refresh.
      refreshInFlight = null
      await refreshSessionIndex()
      return { archived, skipped }
    }
  )

  ipcMain.handle(IPC.LIST_SKILLS, (): SkillItem[] => {
    const agentDir = getAgentDir()
    const dirsToScan: Array<{ dir: string; scope: 'user' | 'project' }> = [
      { dir: path.join(agentDir, 'skills'), scope: 'user' },
      ...(state?.cwd
        ? [{ dir: path.join(state.cwd, '.pi', 'skills'), scope: 'project' as const }]
        : []),
    ]
    const results: SkillItem[] = []
    const seen = new Set<string>()

    for (const { dir, scope } of dirsToScan) {
      if (!fs.existsSync(dir)) continue
      let entries: string[]
      try {
        entries = fs.readdirSync(dir)
      } catch {
        continue
      }

      for (const entry of entries) {
        if (entry.startsWith('.') || entry === 'registry.json' || entry === 'references') continue
        const skillDir = path.join(dir, entry)
        const skillFile = path.join(skillDir, 'SKILL.md')
        try {
          if (!fs.statSync(skillDir).isDirectory()) continue
        } catch {
          continue
        }
        if (!fs.existsSync(skillFile)) continue
        if (seen.has(entry)) continue // project skills shadow global with same name
        seen.add(entry)

        let description = ''
        let tags: string[] = []
        try {
          const content = fs.readFileSync(skillFile, 'utf-8')
          const fmMatch = /^---\n([\s\S]*?)\n---/.exec(content)
          if (fmMatch) {
            const fm = fmMatch[1]
            const descMatch = /^description:\s*(.+)$/m.exec(fm)
            if (descMatch) description = descMatch[1].trim().replace(/^['"]|['"]$/g, '')
            const tagsMatch = /^tags:\s*\[(.+)\]/m.exec(fm)
            if (tagsMatch)
              tags = tagsMatch[1].split(',').map((t) => t.trim().replace(/['"|[\]]/g, ''))
          }
        } catch {
          /* skip unreadable */
        }

        // Per Pi SDK: skills without description are silently skipped
        if (!description) continue

        results.push({ name: entry, description, path: skillDir, scope, tags })
      }
    }
    return results.sort((a, b) => a.name.localeCompare(b.name))
  })

  ipcMain.handle(IPC.READ_SKILL_FILE, (_event, raw: unknown): string | null => {
    const { path: filePath } = readSkillFileRequestSchema.parse(raw)
    // Security: path must be within a known skills directory
    const agentDir = getAgentDir()
    const userSkillsDir = path.join(agentDir, 'skills')
    const projectSkillsDir = state?.cwd ? path.join(state.cwd, '.pi', 'skills') : null
    const resolved = path.resolve(filePath)
    const sep = path.sep
    const isValid =
      resolved.startsWith(userSkillsDir + sep) ||
      (projectSkillsDir != null && resolved.startsWith(projectSkillsDir + sep))
    if (!isValid) return null
    try {
      return fs.readFileSync(resolved, 'utf-8')
    } catch {
      return null
    }
  })

  ipcMain.handle(IPC.LIST_ARCHIVED_SESSIONS, (): ArchivedSessionItem[] => {
    const agentDir = getAgentDir()
    const sessionsDir = path.join(agentDir, 'sessions')
    const results: ArchivedSessionItem[] = []

    let subdirs: string[]
    try {
      subdirs = fs.readdirSync(sessionsDir)
    } catch {
      return []
    }

    for (const dirName of subdirs) {
      const dirPath = path.join(sessionsDir, dirName)
      let stat: fs.Stats
      try {
        stat = fs.statSync(dirPath)
      } catch {
        continue
      }
      if (!stat.isDirectory()) continue

      let files: string[]
      try {
        files = fs.readdirSync(dirPath)
      } catch {
        continue
      }

      for (const file of files) {
        if (!file.endsWith('.jsonl.archived')) continue
        const archivedPath = path.join(dirPath, file)
        const originalPath = archivedPath.slice(0, -'.archived'.length)
        let mtime = 0
        try {
          mtime = fs.statSync(archivedPath).mtimeMs
        } catch {
          /* ignore */
        }
        // Decode workspace name from directory slug: --Users-foo-dev-bar-- -> bar
        const inner = dirName.replace(/^--/, '').replace(/--$/, '')
        const segments = inner.split('-').filter((s) => s.length > 0)
        const workspaceName = segments[segments.length - 1] ?? dirName
        results.push({ archivedPath, originalPath, workspaceName, archivedAt: mtime })
      }
    }

    // Sort most recently archived first
    results.sort((a, b) => b.archivedAt - a.archivedAt)
    return results
  })

  ipcMain.handle(IPC.UNARCHIVE_SESSIONS, async (_event, raw: unknown): Promise<void> => {
    const { paths } = unarchiveSessionsRequestSchema.parse(raw)
    for (const archivedPath of paths) {
      if (!archivedPath.endsWith('.jsonl.archived')) continue
      const originalPath = archivedPath.slice(0, -'.archived'.length)
      try {
        fs.renameSync(archivedPath, originalPath)
      } catch {
        /* skip */
      }
    }
    refreshInFlight = null
    await refreshSessionIndex()
  })

  ipcMain.handle(IPC.READ_THEME_COLORS, (_event, rawPath: unknown) => {
    if (typeof rawPath !== 'string' || !rawPath.endsWith('.json')) return null
    try {
      const content = fs.readFileSync(rawPath, 'utf-8')
      const json = JSON.parse(content) as Record<string, unknown>
      const vars = (json.vars ?? {}) as Record<string, string | number>
      const colors = (json.colors ?? {}) as Record<string, string | number>

      const resolveColor = (val: string | number | undefined): string | null => {
        if (val === undefined || val === null || val === '') return null
        if (typeof val === 'number') return null // 256-color index — skip
        if (val.startsWith('#')) return val
        // var reference
        const resolved = vars[val]
        if (!resolved) return null
        if (typeof resolved === 'string' && resolved.startsWith('#')) return resolved
        return null
      }

      return {
        accent: resolveColor(colors.accent as string),
        border: resolveColor(colors.border as string),
        userMessageBg: resolveColor(colors.userMessageBg as string),
        toolSuccessBg: resolveColor(colors.toolSuccessBg as string),
        toolErrorBg: resolveColor(colors.toolErrorBg as string),
        syntaxKeyword: resolveColor(colors.syntaxKeyword as string),
        syntaxString: resolveColor(colors.syntaxString as string),
        mdHeading: resolveColor(colors.mdHeading as string),
      }
    } catch {
      return null
    }
  })

  ipcMain.handle(IPC.READ_THEME_TOKENS, (_event, rawPath: unknown) => {
    if (typeof rawPath !== 'string' || !rawPath.endsWith('.json')) return null
    try {
      const content = fs.readFileSync(rawPath, 'utf-8')
      const json = JSON.parse(content) as Record<string, unknown>
      const rawVars = (json.vars ?? {}) as Record<string, string | number>
      const rawColors = (json.colors ?? {}) as Record<string, string | number>

      // Resolve a value to a hex string, or null
      const resolveHex = (val: string | number | undefined): string | null => {
        if (val === undefined || val === null || val === '') return null
        if (typeof val === 'number') return null
        if (val.startsWith('#')) return val
        const ref = rawVars[val]
        if (typeof ref === 'string' && ref.startsWith('#')) return ref
        return null
      }

      // Resolved vars palette (only hex entries)
      const vars: Record<string, string> = {}
      for (const [k, v] of Object.entries(rawVars)) {
        const hex = resolveHex(v)
        if (hex) vars[k] = hex
      }

      // Resolved semantic colors (var refs resolved to hex)
      const colors: Record<string, string> = {}
      for (const [k, v] of Object.entries(rawColors)) {
        const hex = resolveHex(v)
        if (hex) colors[k] = hex
      }

      return { vars, colors }
    } catch {
      return null
    }
  })

  // ── Provider management ─────────────────────────────────────────────────────

  ipcMain.handle(IPC.GET_PROVIDERS, async (): Promise<ProviderInfo[]> => {
    const requestId = createRequestId()
    const response = await requirePiSidecar().request<
      Extract<SidecarMessage, { type: 'providers_result' }>
    >({
      type: 'get_providers',
      requestId,
    })
    return response.providers as ProviderInfo[]
  })

  ipcMain.handle(IPC.SET_PROVIDER_KEY, async (_event, raw: unknown): Promise<void> => {
    const { provider, apiKey } = setProviderKeySchema.parse(raw)
    requirePiSidecar().send({ type: 'set_provider_key', provider, apiKey })
  })

  ipcMain.handle(IPC.REMOVE_PROVIDER_KEY, async (_event, raw: unknown): Promise<void> => {
    const { provider } = removeProviderKeySchema.parse(raw)
    requirePiSidecar().send({ type: 'remove_provider_key', provider })
  })

  // ── OAuth subscription login ───────────────────────────────────────────────

  ipcMain.handle(IPC.LOGIN_PROVIDER, async (_event, raw: unknown): Promise<void> => {
    const { providerId } = loginProviderSchema.parse(raw)
    const requestId = createRequestId()
    requirePiSidecar().send({ type: 'login_provider', requestId, providerId })
  })

  ipcMain.handle(IPC.LOGOUT_PROVIDER, async (_event, raw: unknown): Promise<void> => {
    const { providerId } = logoutProviderSchema.parse(raw)
    requirePiSidecar().send({ type: 'logout_provider', providerId })
  })

  ipcMain.handle(IPC.RESOLVE_PROVIDER_PROMPT, (_event, raw: unknown): void => {
    const { providerId, value } = resolveProviderPromptSchema.parse(raw)
    requirePiSidecar().send({ type: 'resolve_provider_prompt', providerId, value })
  })

  // ── Custom provider (models.json) ──────────────────────────────────────────

  ipcMain.handle(IPC.GET_CUSTOM_PROVIDERS, (): CustomProviderInfo[] => {
    const agentDir = getAgentDir()
    const { providers = {} } = readModelsJson(agentDir)
    return Object.entries(providers).map(([id, cfg]) => ({
      id,
      name: cfg.name ?? id,
      baseUrl: cfg.baseUrl ?? '',
      modelCount: Array.isArray(cfg.models) ? cfg.models.length : 0,
      hasApiKey: Boolean(cfg.apiKey),
    }))
  })

  ipcMain.handle(IPC.ADD_CUSTOM_PROVIDER, (_event, raw: unknown): void => {
    const provider = customProviderSchema.parse(raw)
    const agentDir = getAgentDir()
    const modelsJson = readModelsJson(agentDir)

    // Build the entry for models.json
    const entry: ModelsJsonProviderEntry = {
      baseUrl: provider.baseUrl,
      api: 'openai-completions',
      models: provider.models.map((m) => (m.name ? { id: m.id, name: m.name } : { id: m.id })),
    }
    if (provider.name) entry.name = provider.name
    // Store the raw apiKey in models.json so Pi can resolve it.
    // The Pi SDK treats the value as a literal key (not an env-var lookup)
    // when it doesn't start with "!" or look like an env-var name.
    if (provider.apiKey) entry.apiKey = provider.apiKey
    if (provider.headers && Object.keys(provider.headers).length > 0) {
      entry.headers = provider.headers
    }

    modelsJson.providers ??= {}
    modelsJson.providers[provider.id] = entry
    writeModelsJson(agentDir, modelsJson)

    // Invalidate the sidecar registry so the next GET_MODELS / SET_MODEL sees the new provider.
    piSidecarHost?.send({ type: 'invalidate_models' })
  })

  ipcMain.handle(IPC.REMOVE_CUSTOM_PROVIDER, (_event, raw: unknown): void => {
    const { id } = removeCustomProviderSchema.parse(raw)
    const agentDir = getAgentDir()
    const modelsJson = readModelsJson(agentDir)
    if (modelsJson.providers) {
      delete modelsJson.providers[id]
    }
    writeModelsJson(agentDir, modelsJson)
    piSidecarHost?.send({ type: 'invalidate_models' })
  })
}

// ─── Window ────────────────────────────────────────────────────────────────────

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'OpenPi',
    icon: appIconPath(),
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#111111',
    webPreferences: {
      preload: path.resolve(currentDir, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.resolve(currentDir, '../renderer/index.html'))
  }

  mainWindow.webContents.once('did-finish-load', () => {
    ensurePiSidecarStarted()
    void getPtyHost().then((p) => p.setSender(mainWindow!.webContents))

    // ── Fast path: signal the renderer immediately so the session list
    // renders from the current DB state before any JSONL scanning begins.
    // Users see their sessions instantly; fresh data follows once the
    // mtime-based refresh completes (unchanged sessions are no-ops).
    mainWindow?.webContents.send(IPC.SESSION_INDEX_UPDATED)

    const lastWorkspace = sessionIndex?.getLastWorkspace()
    if (lastWorkspace) {
      showDeferredWorkspace(lastWorkspace)
    } else {
      void refreshSessionIndex()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ─── Local file protocol — safe image serving from renderer ─────────────────────
// Registers localfile:// so the sandboxed renderer can load arbitrary
// local images without CSP / sandbox restrictions. Must run before app is ready.
protocol.registerSchemesAsPrivileged([
  { scheme: 'localfile', privileges: { secure: true, standard: false, supportFetchAPI: false } },
])

// ─── App lifecycle ─────────────────────────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  if (process.platform === 'darwin') app.dock?.setIcon(dockIconPath())

  // Handle localfile:// — decode URL pathname and proxy to file protocol
  protocol.handle('localfile', (request) => {
    const filePath = decodeURIComponent(new URL(request.url).pathname)
    return net.fetch(`file://${encodeURI(filePath)}`)
  })

  sessionIndex = new SessionIndexStore(path.join(app.getPath('userData'), 'openpi.sqlite'))
  registerHandlers()
  createWindow()

  // Cold-start app update check — runs after window is created so the
  // renderer is ready to receive APP_UPDATE_STATUS when it subscribes.
  // Delay slightly to not compete with session startup IPC.
  setTimeout(() => {
    void checkForAppUpdate()
      .then((status) => {
        mainWindow?.webContents.send(IPC.APP_UPDATE_STATUS, appUpdateStatusSchema.parse(status))
      })
      .catch(() => {
        /* silently ignore network errors on startup */
      })
  }, 3000)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('quit', () => {
  if (gitHostPromise)
    void getGitHost().then((g) => {
      g.stopGitPoll()
      g.stopFileTreeWatch()
    })
  if (fffHostPromise) void getFffHost().then((host) => host.destroyFff())
  if (piSidecarHost) void piSidecarHost.stop()
  state = null
  if (ptyHostPromise) void getPtyHost().then((p) => p.closeAll())
  sessionIndex?.close()
})
