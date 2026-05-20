/**
 * Pi settings read/write host.
 *
 * Pi settings follow a two-file layering model:
 *   ~/.pi/agent/settings.json  — global (all workspaces)
 *   <cwd>/.pi/settings.json    — project (overrides global, nested-merged)
 *
 * See: https://pi.dev/docs/latest/settings
 */
import fs from 'node:fs'
import path from 'node:path'

export type PiSettings = Record<string, unknown>

export interface SettingsResult {
  global: PiSettings
  project: PiSettings
  /** Deep-merged effective value: global ← project overrides */
  effective: PiSettings
  globalPath: string
  /** null when no active workspace */
  projectPath: string | null
}

// ─── Path helpers ──────────────────────────────────────────────────────────

export function globalSettingsPath(agentDir: string): string {
  return path.join(agentDir, 'settings.json')
}

export function projectSettingsPath(cwd: string): string {
  return path.join(cwd, '.pi', 'settings.json')
}

// ─── JSON helpers ──────────────────────────────────────────────────────────

function readJson(filePath: string): PiSettings {
  try {
    if (!fs.existsSync(filePath)) return {}
    const text = fs.readFileSync(filePath, 'utf-8').trim()
    if (!text) return {}
    return JSON.parse(text) as PiSettings
  } catch {
    return {}
  }
}

/**
 * Deep-merge: `override` values win. Nested plain objects are recursively merged.
 * Arrays and primitives in `override` replace those in `base`.
 */
export function deepMerge(base: PiSettings, override: PiSettings): PiSettings {
  const result: PiSettings = { ...base }
  for (const key of Object.keys(override)) {
    const bVal = base[key]
    const oVal = override[key]
    if (
      oVal !== null &&
      typeof oVal === 'object' &&
      !Array.isArray(oVal) &&
      bVal !== null &&
      typeof bVal === 'object' &&
      !Array.isArray(bVal)
    ) {
      result[key] = deepMerge(bVal as PiSettings, oVal as PiSettings)
    } else {
      result[key] = oVal
    }
  }
  return result
}

// ─── Public API ────────────────────────────────────────────────────────────

export function getSettings(agentDir: string, cwd: string | null): SettingsResult {
  const gPath = globalSettingsPath(agentDir)
  const pPath = cwd ? projectSettingsPath(cwd) : null
  const global = readJson(gPath)
  const project = pPath ? readJson(pPath) : {}
  return {
    global,
    project,
    effective: deepMerge(global, project),
    globalPath: gPath,
    projectPath: pPath,
  }
}

export function saveSettings(
  scope: 'global' | 'project',
  settings: PiSettings,
  agentDir: string,
  cwd: string | null
): void {
  let filePath: string
  if (scope === 'global') {
    filePath = globalSettingsPath(agentDir)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
  } else {
    if (!cwd) throw new Error('No active workspace — cannot save project settings')
    filePath = projectSettingsPath(cwd)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
  }
  fs.writeFileSync(filePath, `${JSON.stringify(settings, null, 2)}\n`, 'utf-8')
}
