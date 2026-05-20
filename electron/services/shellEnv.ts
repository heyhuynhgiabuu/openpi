import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'
import type { AppInfo } from '../../src/lib/ipc'
import { appInfoSchema } from '../../src/lib/ipc'

export const currentDir = path.dirname(fileURLToPath(import.meta.url))

// ── Login-shell PATH enrichment ──────────────────────────────────────────────
// macOS GUI apps launched from Finder/Dock receive a stripped PATH
// (/usr/bin:/bin:/usr/sbin:/sbin) that omits nvm, Homebrew, etc.
// We run the user's login shell once at startup to harvest the full PATH
// so subprocesses (npm, git, node) can be found regardless of launch method.
export function enrichPathFromLoginShell(): void {
  if (process.platform === 'win32') return
  const shell = process.env.SHELL
  if (!shell) return
  try {
    const result = spawnSync(shell, ['-lc', 'echo $PATH'], {
      encoding: 'utf-8',
      timeout: 3000,
      env: {
        HOME: process.env.HOME ?? os.homedir(),
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

export function resolveAppAssetPath(...segments: string[]): string {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, ...segments)]
    : [path.resolve(currentDir, '../..', ...segments), path.resolve(process.cwd(), ...segments)]
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0]
}

export function appIconPath(): string {
  if (process.platform === 'win32') return resolveAppAssetPath('icons', 'icon.ico')
  if (process.platform === 'darwin') return resolveAppAssetPath('icons', 'icon.icns')
  return resolveAppAssetPath('icons', 'icon.png')
}

export function dockIconPath(): string {
  return resolveAppAssetPath('icons', 'icon.png')
}

export function releaseChannelFor(version: string): string | null {
  const explicit = process.env.OPENPI_RELEASE_CHANNEL?.trim()
  if (explicit) return explicit
  const prerelease = version.match(/^[^-]+-([0-9A-Za-z.-]+)/)?.[1]?.split('.')[0]
  return prerelease ?? 'beta'
}

export function getAppInfo(): AppInfo {
  const version = app.getVersion()
  return appInfoSchema.parse({
    name: app.getName() || 'OpenPi',
    version,
    releaseChannel: releaseChannelFor(version),
  })
}

export function safeFileStats(filePath: string): Record<string, unknown> {
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

export const HIGH_RISK_COMMAND_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
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

export function highRiskShellReason(command: string): string | null {
  const normalized = command.replace(/\\\n/g, '\n')
  for (const { pattern, reason } of HIGH_RISK_COMMAND_PATTERNS) {
    if (pattern.test(normalized)) return reason
  }
  return null
}

export function getAgentDir(): string {
  return path.join(app.getPath('home'), '.pi', 'agent')
}

export function isPathInside(parentPath: string, childPath: string): boolean {
  const relative = path.relative(parentPath, childPath)
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}
