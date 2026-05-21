import type { CustomizationItem, PackageOperationRequest } from '../../lib/ipc'

export type PkgSourceType = 'npm' | 'git' | 'local'
export type PackageScope = PackageOperationRequest['scope']

export interface ParsedPkg {
  sourceType: PkgSourceType
  displayName: string
  version: string | null
  ref: string | null
  isPinned: boolean
  externalUrl: string | null
  installCmd: string
}

function parseNpmSpec(spec: string): { pkgName: string; version: string | null } {
  if (spec.startsWith('@')) {
    const secondAt = spec.indexOf('@', 1)
    if (secondAt === -1) return { pkgName: spec, version: null }
    return { pkgName: spec.slice(0, secondAt), version: spec.slice(secondAt + 1) }
  }
  const atIdx = spec.indexOf('@')
  if (atIdx === -1) return { pkgName: spec, version: null }
  return { pkgName: spec.slice(0, atIdx), version: spec.slice(atIdx + 1) }
}

export function parsePackage(name: string): ParsedPkg {
  if (name.startsWith('npm:')) {
    const spec = name.slice(4)
    const { pkgName, version } = parseNpmSpec(spec)
    return {
      sourceType: 'npm',
      displayName: pkgName,
      version,
      ref: null,
      isPinned: version !== null,
      externalUrl: `https://www.npmjs.com/package/${pkgName}`,
      installCmd: `pi install ${name}`,
    }
  }

  if (name.startsWith('git:')) {
    const spec = name.slice(4)
    const hashIdx = spec.lastIndexOf('#')
    const base = hashIdx === -1 ? spec : spec.slice(0, hashIdx)
    const ref = hashIdx === -1 ? null : spec.slice(hashIdx + 1)
    const repoName =
      base
        .split('/')
        .pop()
        ?.replace(/\.git$/, '') ?? 'repo'
    return {
      sourceType: 'git',
      displayName: repoName,
      version: null,
      ref,
      isPinned: ref !== null,
      externalUrl: base,
      installCmd: `pi install ${name}`,
    }
  }

  if (name.startsWith('/') || name.startsWith('.')) {
    const parts = name.split('/')
    const folder = parts[parts.length - 1] ?? 'folder'
    return {
      sourceType: 'local',
      displayName: folder,
      version: null,
      ref: null,
      isPinned: false,
      externalUrl: null,
      installCmd: `pi install ${name}`,
    }
  }

  const { pkgName, version } = parseNpmSpec(name)
  return {
    sourceType: 'npm',
    displayName: pkgName,
    version,
    ref: null,
    isPinned: version !== null,
    externalUrl: `https://www.npmjs.com/package/${pkgName}`,
    installCmd: `pi install ${name}`,
  }
}

export function normalizeInstallSource(value: string): string {
  if (
    value.startsWith('npm:') ||
    value.startsWith('git:') ||
    value.startsWith('/') ||
    value.startsWith('.')
  ) {
    return value
  }
  return `npm:${value}`
}

export function shortenPath(p: string | null): string {
  if (!p) return ''
  return p.length > 40 ? `…${p.slice(-40)}` : p
}

export function formatModifiedAt(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) {
    const diffHrs = Math.floor(diffMs / (1000 * 60 * 60))
    if (diffHrs === 0) {
      const diffMins = Math.floor(diffMs / (1000 * 60))
      return `${diffMins}m ago`
    }
    return `${diffHrs}h ago`
  }
  if (diffDays === 1) return 'yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`
  return `${Math.floor(diffDays / 365)}y ago`
}

export const SCOPE_LABELS: Record<string, string> = {
  global: 'Global',
  project: 'Project',
}

export const DISPLAY_SCOPE: Record<string, string> = {
  global: '@global',
  project: '@project',
}

export const SOURCE_LABELS: Record<PkgSourceType, string> = {
  npm: 'npm',
  git: 'Git',
  local: 'Local',
}

export const SOURCE_ORDER: PkgSourceType[] = ['npm', 'git', 'local']

export interface ParsedEntry {
  item: CustomizationItem
  parsed: ParsedPkg
}
