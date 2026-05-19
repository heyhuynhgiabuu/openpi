/**
 * updater — Electron autoUpdater integration.
 *
 * Uses electron-updater to check for, download, and install app updates
 * from GitHub Releases.  Silent download with auto-install on quit.
 *
 * Exposes the same API surface as the previous manual GitHub fetch so the
 * IPC handlers and renderer code continue to work unchanged.
 *
 * The autoUpdater setup is lazy: call initAutoUpdater() once during app
 * startup, then use checkForAppUpdate() on demand.
 */

import fs from 'node:fs'
import path from 'node:path'
import type { BrowserWindow } from 'electron'
import { app, shell } from 'electron'
import log from 'electron-log'
import { autoUpdater } from 'electron-updater'
import type { AppUpdateStatus } from '../src/lib/ipc'

// ─── Logging ─────────────────────────────────────────────────────────────────

autoUpdater.logger = log
// electron-log transports typed as indexer; configure after assignment
;(autoUpdater.logger as typeof log).transports.file.level = 'info'

// ─── State ────────────────────────────────────────────────────────────────────

type StatusListener = (status: AppUpdateStatus) => void

let initCalled = false
const listeners = new Set<StatusListener>()
let currentStatus: AppUpdateStatus = {
  state: 'idle',
  currentVersion: app.getVersion(),
  latestVersion: null,
  releaseUrl: null,
  checkedAt: null,
  error: null,
}

function emitStatus(partial: Partial<AppUpdateStatus>): void {
  currentStatus = { ...currentStatus, ...partial, currentVersion: app.getVersion() }
  for (const fn of listeners) fn(currentStatus)
}

// ─── Init ─────────────────────────────────────────────────────────────────────

/**
 * Wire up electron-updater event handlers.  Call once during app startup.
 * The autoUpdater is configured via electron-builder.json `publish` config.
 */
export function initAutoUpdater(mainWindow: BrowserWindow | null): void {
  if (initCalled) return
  initCalled = true

  // Only enable auto-download for packaged builds
  autoUpdater.autoDownload = app.isPackaged
  autoUpdater.autoInstallOnAppQuit = app.isPackaged

  // Register as a listener that forwards to the main window
  subscribe((status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('openpi:app-update-status', status)
    }
  })

  // ── Event handlers ─────────────────────────────────────────────────────

  autoUpdater.on('checking-for-update', () => {
    log.info('[updater] checking for update')
    emitStatus({ state: 'checking', error: null })
  })

  autoUpdater.on('update-available', (info) => {
    log.info(`[updater] update available: ${info.version}`)
    const releaseUrl = `https://github.com/heyhuynhgiabuu/openpi/releases/tag/v${info.version}`
    emitStatus({
      state: 'available',
      latestVersion: info.version,
      releaseUrl,
      error: null,
    })
  })

  autoUpdater.on('update-not-available', (info) => {
    log.info(`[updater] up to date (${info.version})`)
    emitStatus({
      state: 'up-to-date',
      latestVersion: info.version,
      releaseUrl: null,
      error: null,
    })
  })

  autoUpdater.on('error', (err) => {
    log.error(`[updater] error: ${err.message}`)
    // Don't swallow the current latestVersion on transient errors
    emitStatus({
      state: 'error',
      error: err instanceof Error ? err.message : String(err),
    })
  })

  autoUpdater.on('download-progress', (progress) => {
    log.info(
      `[updater] download progress: ${progress.percent.toFixed(1)}% ` +
        `(${(progress.transferred / 1_000_000).toFixed(1)}/${(progress.total / 1_000_000).toFixed(1)} MB)`
    )
    // Could emit a custom download progress event here, but keep it simple for now.
  })

  autoUpdater.on('update-downloaded', (info) => {
    log.info(`[updater] update downloaded: ${info.version}`)
    // Update remains in 'available' state; caller can call quitAndInstall().
  })
}

// ─── Subscribe / unsubscribe ──────────────────────────────────────────────────

export function subscribe(fn: StatusListener): () => void {
  listeners.add(fn)
  // Immediately deliver current state
  fn(currentStatus)
  return () => {
    listeners.delete(fn)
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Trigger an update check and wait for the result.
 * Returns the status reflecting the check outcome.
 */
export async function checkForAppUpdate(): Promise<AppUpdateStatus> {
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    log.error(`[updater] checkForUpdates threw: ${err}`)
    // If no event was emitted for this error, emit one now
    if (currentStatus.state !== 'error') {
      emitStatus({
        state: 'error',
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return currentStatus
}

/**
 * Open the GitHub release page in the default browser.
 */
export function openReleasePage(releaseUrl: string): void {
  void shell.openExternal(releaseUrl)
}

/**
 * Quit and install the downloaded update.
 */
export function quitAndInstall(): void {
  autoUpdater.quitAndInstall()
}

// ─── Changelog reader ─────────────────────────────────────────────────────────

/**
 * Read CHANGELOG.md from the app bundle.
 *
 * Production: electron-builder copies it to process.resourcesPath via extraResources.
 * Development: read from the project root (two levels up from out/main/).
 */
export function readChangelog(): string | null {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'CHANGELOG.md')]
    : [path.join(__dirname, '../../CHANGELOG.md'), path.join(process.cwd(), 'CHANGELOG.md')]

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return fs.readFileSync(candidate, 'utf8')
      }
    } catch {
      /* try next */
    }
  }

  return null
}
