import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  DefaultPackageManager,
  DefaultResourceLoader,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import type {
  CustomizationDiagnostic,
  CustomizationItem,
  CustomizationsInventory,
  PackageOperationResult,
} from '../../src/lib/ipc'
import { packageOperationResultSchema } from '../../src/lib/ipc'
import {
  dedupeItems,
  discoverExtensionItems,
  itemId,
  mtimeIso,
  riskLevelForType,
  type SourceScope,
  sourceFrom,
  toDiagnostic,
} from './customizationHelpers'

type PackageOperationScope = Exclude<SourceScope, 'temporary'>

export async function installCustomizationPackage(options: {
  cwd: string | null
  agentDir: string
  source: string
  scope: PackageOperationScope
}): Promise<PackageOperationResult> {
  return runPackageOperation({ ...options, action: 'install' })
}

export async function removeCustomizationPackage(options: {
  cwd: string | null
  agentDir: string
  source: string
  scope: PackageOperationScope
}): Promise<PackageOperationResult> {
  return runPackageOperation({ ...options, action: 'remove' })
}

async function runPackageOperation(options: {
  cwd: string | null
  agentDir: string
  source: string
  scope: PackageOperationScope
  action: 'install' | 'remove'
}): Promise<PackageOperationResult> {
  const { cwd, agentDir, source, scope, action } = options
  if (!cwd) {
    return packageOperationResultSchema.parse({
      ok: false,
      output: 'Open a workspace before managing Pi packages.',
    })
  }

  const settingsManager = SettingsManager.create(cwd, agentDir)
  const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager })
  const messages: string[] = []
  packageManager.setProgressCallback((event) => {
    if (event.message) messages.push(event.message)
  })

  try {
    const local = scope === 'project'
    if (action === 'install') {
      await packageManager.installAndPersist(source, { local })
    } else {
      const removed = await packageManager.removeAndPersist(source, { local })
      if (!removed) {
        return packageOperationResultSchema.parse({
          ok: false,
          output: `No matching ${scope === 'project' ? 'project' : 'global'} package found for ${source}.`,
        })
      }
    }
    await settingsManager.flush()

    return packageOperationResultSchema.parse({
      ok: true,
      output: [...messages, `${action === 'install' ? 'Installed' : 'Removed'} ${source}.`].join(
        '\n'
      ),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return packageOperationResultSchema.parse({
      ok: false,
      output: [...messages, message].filter(Boolean).join('\n'),
    })
  }
}

const EXTENSION_PREFERENCES_FILE = 'openpi-extension-preferences.json'

/**
 * Read saved extension enable/disable preferences from a JSON file.
 * Returns a map of extension id → enabled boolean.
 */
function readExtensionPreferences(agentDir: string): Map<string, boolean> {
  const prefsPath = path.join(agentDir, EXTENSION_PREFERENCES_FILE)
  try {
    const raw = readFileSync(prefsPath, 'utf-8')
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return new Map()
    const map = new Map<string, boolean>()
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'boolean') map.set(key, value)
    }
    return map
  } catch {
    return new Map()
  }
}

/**
 * Save extension enable/disable preferences for a single extension.
 */
export function setExtensionEnabled(agentDir: string, id: string, enabled: boolean): void {
  const prefsPath = path.join(agentDir, EXTENSION_PREFERENCES_FILE)
  const prefs = readExtensionPreferences(agentDir)
  prefs.set(id, enabled)
  mkdirSync(agentDir, { recursive: true })
  const obj: Record<string, boolean> = {}
  for (const [key, value] of prefs) obj[key] = value
  writeFileSync(prefsPath, JSON.stringify(obj, null, 2), 'utf-8')
}

/** Merge saved extension preferences into a discovered customization item. */
function applyExtensionPreference(
  item: CustomizationItem,
  prefs: Map<string, boolean>
): CustomizationItem {
  if (item.type !== 'extensions') return item
  const saved = prefs.get(item.id)
  if (saved !== undefined) return { ...item, enabled: saved }
  return item
}

export async function discoverCustomizations(options: {
  cwd: string | null
  agentDir: string
  workspaceTrusted: boolean
}): Promise<CustomizationsInventory> {
  const { cwd, agentDir, workspaceTrusted } = options
  if (!cwd) {
    return { cwd: null, workspaceTrusted: false, items: [], diagnostics: [] }
  }

  const settingsManager = SettingsManager.create(cwd, agentDir)
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noExtensions: true,
  })
  const items: CustomizationItem[] = []
  const diagnostics: CustomizationDiagnostic[] = []

  // loader.reload() invokes the Pi SDK package manager which may run `npm root -g`.
  // If npm is not in PATH (e.g., GUI-launched on macOS from Finder/Dock),
  // capture the failure as a warning so skills/prompts/themes still load from fs.
  await loader.reload().catch((err: unknown) => {
    diagnostics.push({
      type: 'warning' as const,
      message: `Package resource resolution failed (npm may not be in PATH): ${
        err instanceof Error ? err.message : String(err)
      }`,
    })
  })

  items.push(
    ...discoverExtensionItems({ cwd, agentDir, settingsManager, diagnostics, workspaceTrusted })
  )

  const skills = loader.getSkills()
  diagnostics.push(...skills.diagnostics.map(toDiagnostic))
  for (const skill of skills.skills) {
    const source = sourceFrom(skill.sourceInfo, skill.filePath)
    items.push({
      id: itemId('skills', skill.filePath),
      type: 'skills',
      name: skill.name,
      description: skill.description,
      path: skill.filePath,
      scope: source.scope,
      origin: source.origin,
      source: source.source,
      enabled: !skill.disableModelInvocation,
      packageSource: source.origin === 'package' ? source.source : undefined,
      riskLevel: riskLevelForType('skills'),
      lastModifiedAt: mtimeIso(skill.filePath),
    })
  }

  const prompts = loader.getPrompts()
  diagnostics.push(...prompts.diagnostics.map(toDiagnostic))
  for (const prompt of prompts.prompts) {
    const source = sourceFrom(prompt.sourceInfo, prompt.filePath)
    items.push({
      id: itemId('prompts', prompt.filePath),
      type: 'prompts',
      name: prompt.name,
      description: prompt.description || prompt.argumentHint,
      argumentHint: prompt.argumentHint,
      path: prompt.filePath,
      scope: source.scope,
      origin: source.origin,
      source: source.source,
      enabled: true,
      packageSource: source.origin === 'package' ? source.source : undefined,
      riskLevel: riskLevelForType('prompts'),
      lastModifiedAt: mtimeIso(prompt.filePath),
    })
  }

  const themes = loader.getThemes()
  diagnostics.push(...themes.diagnostics.map(toDiagnostic))
  for (const theme of themes.themes) {
    const themePath = theme.sourcePath ?? theme.sourceInfo?.path ?? null
    const source = sourceFrom(theme.sourceInfo, themePath)
    items.push({
      id: itemId('themes', themePath ?? theme.name ?? 'theme'),
      type: 'themes',
      name:
        theme.name ??
        (themePath ? path.basename(themePath, path.extname(themePath)) : 'Unnamed theme'),
      description: themePath ?? undefined,
      path: themePath,
      scope: source.scope,
      origin: source.origin,
      source: source.source,
      enabled: true,
      packageSource: source.origin === 'package' ? source.source : undefined,
      riskLevel: riskLevelForType('themes'),
      lastModifiedAt: mtimeIso(themePath),
    })
  }

  try {
    const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager })
    for (const configured of packageManager.listConfiguredPackages()) {
      items.push({
        id: `packages:${configured.scope}:${configured.source}`,
        type: 'packages',
        name: configured.source,
        description: configured.filtered
          ? 'Configured with resource filters'
          : 'Configured Pi package source',
        path: configured.installedPath ?? null,
        scope: configured.scope,
        origin: 'package',
        source: configured.source,
        enabled: true,
        packageSource: configured.source,
        riskLevel: 'medium' as const,
        lastModifiedAt: mtimeIso(configured.installedPath ?? null),
      })
    }
  } catch (err) {
    // listConfiguredPackages() calls `npm root -g` for user-scoped npm packages.
    // If npm is not in PATH (GUI-launched app on macOS), degrade gracefully.
    diagnostics.push({
      type: 'warning',
      message: `Pi package discovery unavailable (npm may not be in PATH): ${
        err instanceof Error ? err.message : String(err)
      }`,
    })
  }

  const dedupedItems = dedupeItems(items)

  // Merge saved extension enable/disable preferences
  const prefs = readExtensionPreferences(agentDir)
  const itemsWithPrefs = dedupedItems.map((item) => applyExtensionPreference(item, prefs))

  return {
    cwd,
    workspaceTrusted,
    items: itemsWithPrefs,
    diagnostics,
  }
}
