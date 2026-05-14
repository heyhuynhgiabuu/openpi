/**
 * protectedPaths — main-process policy for sensitive filesystem locations.
 *
 * Authority: Electron main owns all filesystem mutation decisions. The renderer
 * is intent-only; it must not bypass this module when requesting writes, stages,
 * or commits.
 *
 * Protection categories:
 *   HARD   — blocked unconditionally (private keys, auth material)
 *   SOFT   — warns and requires explicit confirmation (shell profiles, Pi config)
 *   SCOPE  — blocked when path is outside the trusted workspace boundary
 */

import os from 'node:os'
import path from 'node:path'

export type ProtectionLevel = 'hard' | 'soft' | 'scope'

export type PathViolation = {
  /** Matched rule label for logging / telemetry */
  rule: string
  /** 'hard' = blocked unconditionally; 'soft' = requires confirmation; 'scope' = outside workspace */
  level: ProtectionLevel
  /** Human-readable reason to surface in UI */
  reason: string
}

type ProtectedRule = {
  rule: string
  level: ProtectionLevel
  reason: string
  /** Returns true when targetPath matches this rule */
  matches: (targetPath: string) => boolean
}

// ---------------------------------------------------------------------------
// Rule definitions
// ---------------------------------------------------------------------------

const HOME = os.homedir()

/** Expand ~ to the real home dir and normalise separators */
function homeDir(...parts: string[]): string {
  return path.join(HOME, ...parts)
}

/** True when targetPath is equal to or nested inside parentDir */
function isUnder(targetPath: string, parentDir: string): boolean {
  const rel = path.relative(parentDir, targetPath)
  return !rel.startsWith('..') && !path.isAbsolute(rel)
}

/** True when targetPath is exactly filePath (case-sensitive) */
function isExact(targetPath: string, filePath: string): boolean {
  return targetPath === filePath
}

const HARD_RULES: ProtectedRule[] = [
  {
    rule: 'ssh-dir',
    level: 'hard',
    reason: 'Writing to ~/.ssh could expose or overwrite private SSH keys.',
    matches: (p) => isUnder(p, homeDir('.ssh')),
  },
  {
    rule: 'gnupg-dir',
    level: 'hard',
    reason: 'Writing to ~/.gnupg could expose or overwrite GPG keys and trust chains.',
    matches: (p) => isUnder(p, homeDir('.gnupg')),
  },
  {
    rule: 'pi-auth-storage',
    level: 'hard',
    reason: 'OpenPi manages model credentials through safeStorage — direct writes are blocked.',
    matches: (p) =>
      isUnder(p, homeDir('.pi', 'agent', 'auth')) ||
      isExact(p, homeDir('.pi', 'agent', 'auth.json')),
  },
  {
    rule: 'git-objects',
    level: 'hard',
    reason: 'Writing directly into .git/objects can corrupt repository history.',
    matches: (p) => /[/\\]\.git[/\\]objects([/\\]|$)/.test(p),
  },
]

const SOFT_RULES: ProtectedRule[] = [
  {
    rule: 'shell-profile-zsh',
    level: 'soft',
    reason: 'Modifying ~/.zshrc or ~/.zprofile affects your shell environment for all sessions.',
    matches: (p) => isExact(p, homeDir('.zshrc')) || isExact(p, homeDir('.zprofile')),
  },
  {
    rule: 'shell-profile-bash',
    level: 'soft',
    reason: 'Modifying bash startup files affects your shell environment for all sessions.',
    matches: (p) =>
      isExact(p, homeDir('.bashrc')) ||
      isExact(p, homeDir('.bash_profile')) ||
      isExact(p, homeDir('.profile')),
  },
  {
    rule: 'shell-profile-fish',
    level: 'soft',
    reason: 'Modifying Fish config affects your shell environment for all sessions.',
    matches: (p) => isUnder(p, homeDir('.config', 'fish')),
  },
  {
    rule: 'pi-global-settings',
    level: 'soft',
    reason:
      '~/.pi/agent/settings.json controls Pi global configuration; review before applying changes.',
    matches: (p) =>
      isExact(p, homeDir('.pi', 'agent', 'settings.json')) ||
      isExact(p, homeDir('.pi', 'agent', 'AGENTS.md')) ||
      isExact(p, homeDir('.pi', 'agent', 'CLAUDE.md')),
  },
  {
    rule: 'git-config',
    level: 'soft',
    reason: 'Modifying ~/.gitconfig changes your global Git identity and behaviour.',
    matches: (p) => isExact(p, homeDir('.gitconfig')) || isExact(p, homeDir('.gitconfig_global')),
  },
]

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check whether targetPath is protected.
 *
 * @param targetPath  Absolute, normalised path to inspect.
 * @param workspacePath  If provided, paths strictly outside this workspace are
 *   considered scope violations (level 'scope').
 * @returns  The first matching violation, or null when no protection applies.
 */
export function checkProtectedPath(
  targetPath: string,
  workspacePath?: string | null
): PathViolation | null {
  const resolved = path.resolve(targetPath)

  for (const rule of HARD_RULES) {
    if (rule.matches(resolved)) {
      return { rule: rule.rule, level: rule.level, reason: rule.reason }
    }
  }

  for (const rule of SOFT_RULES) {
    if (rule.matches(resolved)) {
      return { rule: rule.rule, level: rule.level, reason: rule.reason }
    }
  }

  if (workspacePath) {
    const resolvedWorkspace = path.resolve(workspacePath)
    if (!isUnder(resolved, resolvedWorkspace)) {
      return {
        rule: 'outside-workspace',
        level: 'scope',
        reason: `Path is outside the active workspace (${path.basename(resolvedWorkspace)}). Confirm before writing.`,
      }
    }
  }

  return null
}

/**
 * Returns true when the path is HARD-blocked and must never be written.
 * Callers that only need a boolean gate (e.g. Git stage filter) can use this
 * instead of inspecting the full violation object.
 */
export function isHardBlocked(targetPath: string): boolean {
  const resolved = path.resolve(targetPath)
  return HARD_RULES.some((rule) => rule.matches(resolved))
}

/**
 * Filter a list of file paths, returning only those that pass all HARD rules.
 * Safe to call in Git stage/commit handlers to prevent accidentally staging
 * protected files that the Pi agent or a buggy renderer included in the set.
 */
export function filterBlockedPaths(filePaths: string[]): {
  allowed: string[]
  blocked: Array<{ path: string; violation: PathViolation }>
} {
  const allowed: string[] = []
  const blocked: Array<{ path: string; violation: PathViolation }> = []

  for (const filePath of filePaths) {
    const violation = checkProtectedPath(filePath)
    if (violation && violation.level === 'hard') {
      blocked.push({ path: filePath, violation })
    } else {
      allowed.push(filePath)
    }
  }

  return { allowed, blocked }
}
