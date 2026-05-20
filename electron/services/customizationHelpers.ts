/**
 * customizationHelpers.ts — Internal helpers for customization discovery.
 * Extracted from customizations.ts.
 */

import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import type { SettingsManager } from '@earendil-works/pi-coding-agent'
import type {
  CustomizationDiagnostic,
  CustomizationItem,
  ResourceRiskLevel,
} from '../../src/lib/ipc'

// ─── Shared types ──────────────────────────────────────────────────────────

export type SourceScope = 'user' | 'project' | 'temporary'
export type SourceOrigin = 'top-level' | 'package' | 'settings'

export type SourceLike = {
  path?: string
  source?: string
  scope?: SourceScope
  origin?: 'top-level' | 'package'
  baseDir?: string
}

export type DiagnosticLike = {
  type?: string
  message?: string
  path?: string
}

const EXTENSION_ENTRY_EXTENSIONS = new Set(['.ts'])

export function isExtensionEntryFile(filePath: string): boolean {
  return EXTENSION_ENTRY_EXTENSIONS.has(path.extname(filePath))
}

export function riskLevelForType(type: CustomizationItem['type']): ResourceRiskLevel {
  if (type === 'extensions') return 'high'
  if (type === 'packages') return 'medium'
  return 'low'
}

export function mtimeIso(filePath: string | null | undefined): string | null {
  if (!filePath) return null
  try {
    return new Date(statSync(filePath).mtimeMs).toISOString()
  } catch {
    return null
  }
}

export function sourceFrom(
  sourceInfo: SourceLike | undefined,
  fallbackPath: string | null | undefined
): Required<Pick<SourceLike, 'source' | 'scope' | 'origin'>> {
  if (sourceInfo) {
    return {
      source: sourceInfo.source ?? inferSource(fallbackPath),
      scope: sourceInfo.scope ?? inferScope(fallbackPath),
      origin: sourceInfo.origin ?? 'top-level',
    }
  }
  return {
    source: inferSource(fallbackPath),
    scope: inferScope(fallbackPath),
    origin: 'top-level',
  }
}

export function inferScope(filePath: string | null | undefined): SourceScope {
  if (filePath?.includes(`${path.sep}.pi${path.sep}`)) return 'project'
  return 'user'
}

export function inferSource(filePath: string | null | undefined): string {
  if (!filePath) return 'built-in'
  if (filePath.includes(`${path.sep}.pi${path.sep}`)) return 'project-local'
  return 'user-global'
}

export function toDiagnostic(diagnostic: DiagnosticLike): CustomizationDiagnostic {
  const kind =
    diagnostic.type === 'error' ? 'error' : diagnostic.type === 'info' ? 'info' : 'warning'
  return {
    type: kind,
    message: diagnostic.message ?? 'Resource diagnostic',
    path: diagnostic.path,
  }
}

export function resolveConfiguredPath(inputPath: string, baseDir: string): string {
  if (path.isAbsolute(inputPath)) return inputPath
  return path.resolve(baseDir, inputPath)
}

export function extensionName(filePath: string): string {
  const base = path.basename(filePath, path.extname(filePath))
  if (base === 'index') return path.basename(path.dirname(filePath))
  return base
}

export function discoverExtensionItems(options: {
  cwd: string
  agentDir: string
  settingsManager: SettingsManager
  diagnostics: CustomizationDiagnostic[]
  workspaceTrusted: boolean
}): CustomizationItem[] {
  const { cwd, agentDir, settingsManager, diagnostics, workspaceTrusted } = options
  const items: CustomizationItem[] = []

  const globalSettings = settingsManager.getGlobalSettings()
  const projectSettings = settingsManager.getProjectSettings()

  items.push(
    ...collectExtensionPath(path.join(agentDir, 'extensions'), {
      scope: 'user',
      origin: 'top-level',
      source: 'user-global',
      diagnostics,
      workspaceTrusted,
    })
  )
  items.push(
    ...collectExtensionPath(path.join(cwd, '.pi', 'extensions'), {
      scope: 'project',
      origin: 'top-level',
      source: 'project-local',
      diagnostics,
      workspaceTrusted,
    })
  )

  for (const configuredPath of globalSettings.extensions ?? []) {
    items.push(
      ...collectExtensionPath(resolveConfiguredPath(configuredPath, agentDir), {
        scope: 'user',
        origin: 'settings',
        source: 'settings.json',
        diagnostics,
        configuredPath,
        workspaceTrusted,
      })
    )
  }

  for (const configuredPath of projectSettings.extensions ?? []) {
    items.push(
      ...collectExtensionPath(resolveConfiguredPath(configuredPath, cwd), {
        scope: 'project',
        origin: 'settings',
        source: '.pi/settings.json',
        diagnostics,
        configuredPath,
        workspaceTrusted,
      })
    )
  }

  return items
}

export function collectExtensionPath(
  targetPath: string,
  options: {
    scope: SourceScope
    origin: SourceOrigin
    source: string
    diagnostics: CustomizationDiagnostic[]
    configuredPath?: string
    workspaceTrusted: boolean
  }
): CustomizationItem[] {
  const resolvedPath = path.resolve(targetPath)
  if (!existsSync(resolvedPath)) {
    if (options.configuredPath) {
      options.diagnostics.push({
        type: 'warning',
        message: `Configured extension path does not exist: ${options.configuredPath}`,
        path: resolvedPath,
        scope: options.scope,
      })
    }
    return []
  }

  const files = collectExtensionFiles(resolvedPath)
  return files.map((filePath) => ({
    id: itemId('extensions', filePath),
    type: 'extensions' as const,
    name: extensionName(filePath),
    description:
      options.scope === 'project'
        ? 'Project-local executable Pi extension.'
        : 'Executable Pi extension.',
    path: filePath,
    scope: options.scope,
    origin: options.origin,
    source: options.source,
    enabled: options.scope === 'user' ? true : options.workspaceTrusted,
    warning:
      options.scope !== 'user' && !options.workspaceTrusted
        ? 'Project extensions have full system permissions and require workspace trust before OpenPi loads them.'
        : undefined,
    riskLevel: 'high' as const,
    lastModifiedAt: mtimeIso(filePath),
  }))
}

export function collectExtensionFiles(targetPath: string): string[] {
  const resolvedPath = path.resolve(targetPath)
  const stats = statSync(resolvedPath)
  if (stats.isFile()) {
    if (isExtensionEntryFile(resolvedPath)) return [resolvedPath]
    return []
  }
  if (!stats.isDirectory()) return []

  const files: string[] = []

  for (const entry of readdirSync(resolvedPath, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const entryPath = path.join(resolvedPath, entry.name)
    if (entry.isFile() && isExtensionEntryFile(entryPath)) {
      files.push(entryPath)
      continue
    }
    if (entry.isDirectory()) {
      const indexPath = path.join(entryPath, 'index.ts')
      if (existsSync(indexPath) && statSync(indexPath).isFile()) {
        files.push(indexPath)
      }
    }
  }

  return files.sort((a, b) => a.localeCompare(b))
}

export function itemId(type: CustomizationItem['type'], key: string): string {
  return `${type}:${key}`
}

export function dedupeItems(items: CustomizationItem[]): CustomizationItem[] {
  const byId = new Map<string, CustomizationItem>()
  for (const item of items) {
    const existing = byId.get(item.id)
    if (!existing) {
      byId.set(item.id, item)
      continue
    }
    byId.set(item.id, {
      ...existing,
      enabled: existing.enabled || item.enabled,
      origin: existing.origin === 'settings' ? existing.origin : item.origin,
      source:
        existing.source === item.source ? existing.source : `${existing.source}, ${item.source}`,
    })
  }
  return [...byId.values()].sort((a, b) => {
    if (a.type !== b.type) return a.type.localeCompare(b.type)
    if (a.scope !== b.scope) return a.scope.localeCompare(b.scope)
    return a.name.localeCompare(b.name)
  })
}
