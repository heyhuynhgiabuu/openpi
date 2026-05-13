/**
 * updater — GitHub Releases-based app self-update checker.
 *
 * Strategy: fetch the latest published GitHub release, compare its semver tag
 * against the running app.getVersion(), and push an AppUpdateStatus event to
 * the renderer.  For unsigned beta builds we open the browser to the release
 * page; once the app is notarized/signed this can be upgraded to
 * electron-updater for silent download + auto-restart.
 */

import fs from 'node:fs'
import path from 'node:path'
import { app, shell } from 'electron'
import type { AppUpdateStatus } from '../src/lib/ipc'

const OWNER = 'heyhuynhgiabuu'
const REPO = 'openpi'
const RELEASES_API = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`

// ─── semver compare ───────────────────────────────────────────────────────────

function parseSemver(v: string): [number, number, number] {
  const clean = v.replace(/^v/, '')
  const [major = 0, minor = 0, patch = 0] = clean.split('.').map(Number)
  return [major, minor, patch]
}

function isNewer(latest: string, current: string): boolean {
  const [lMaj, lMin, lPat] = parseSemver(latest)
  const [cMaj, cMin, cPat] = parseSemver(current)
  if (lMaj !== cMaj) return lMaj > cMaj
  if (lMin !== cMin) return lMin > cMin
  return lPat > cPat
}

// ─── public API ───────────────────────────────────────────────────────────────

/**
 * Fetch the latest GitHub release and return an AppUpdateStatus.
 * Never throws — errors are captured in the status object.
 */
export async function checkForAppUpdate(): Promise<AppUpdateStatus> {
  const currentVersion = app.getVersion()
  const checkedAt = new Date().toISOString()

  try {
    const res = await fetch(RELEASES_API, {
      headers: {
        'user-agent': `openpi/${currentVersion}`,
        accept: 'application/vnd.github+json',
      },
    })

    if (!res.ok) {
      throw new Error(`GitHub API returned HTTP ${res.status}`)
    }

    const data = (await res.json()) as {
      tag_name?: unknown
      html_url?: unknown
    }

    const latestVersion = typeof data.tag_name === 'string' ? data.tag_name : null
    const releaseUrl = typeof data.html_url === 'string' ? data.html_url : null

    if (!latestVersion) {
      throw new Error('GitHub release response did not include tag_name.')
    }

    const available = isNewer(latestVersion, currentVersion)
    return {
      state: available ? 'available' : 'up-to-date',
      currentVersion,
      latestVersion,
      releaseUrl,
      checkedAt,
      error: null,
    }
  } catch (err) {
    return {
      state: 'error',
      currentVersion,
      latestVersion: null,
      releaseUrl: null,
      checkedAt,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Open the GitHub release page in the default browser.
 */
export function openReleasePage(releaseUrl: string): void {
  void shell.openExternal(releaseUrl)
}

// ─── changelog reader ─────────────────────────────────────────────────────────

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
