import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'

export function detectPackageManager(
  appPath: string,
  hasOnPathFn: (bin: string) => boolean = hasOnPath
): PackageManager | null {
  const lockfiles: readonly [PackageManager, string][] = [
    ['pnpm', 'pnpm-lock.yaml'],
    ['yarn', 'yarn.lock'],
    ['bun', 'bun.lock'],
    ['bun', 'bun.lockb'],
    ['npm', 'package-lock.json'],
  ]
  const nodeModulesPath = path.join(appPath, 'node_modules')
  const pnpmInstall = fs.existsSync(path.join(nodeModulesPath, '.modules.yaml'))
  const npmInstall = fs.existsSync(path.join(nodeModulesPath, '.package-lock.json'))
  if (pnpmInstall) {
    // pnpm's modules manifest identifies the active flat-link layout. An npm
    // hidden lock can remain stale after switching managers, so it must not
    // make this tree fall back to npm.
    if (!fs.existsSync(path.join(appPath, 'pnpm-lock.yaml'))) return null
    return hasOnPathFn('pnpm') ? 'pnpm' : null
  }
  if (npmInstall) {
    if (!fs.existsSync(path.join(appPath, 'package-lock.json'))) return null
    return hasOnPathFn('npm') ? 'npm' : null
  }

  let hasLockfile = false
  for (const [manager, lockfile] of lockfiles) {
    if (!fs.existsSync(path.join(appPath, lockfile))) continue
    hasLockfile = true
    if (hasOnPathFn(manager)) return manager
  }
  if (hasLockfile) return null

  // No lockfile — fall back to the first package manager on PATH.
  for (const candidate of ['npm', 'pnpm', 'yarn', 'bun'] as const) {
    if (hasOnPathFn(candidate)) return candidate
  }
  return null
}

export function pathLookupCommand(platform: NodeJS.Platform): 'where.exe' | 'which' {
  return platform === 'win32' ? 'where.exe' : 'which'
}

export function hasOnPath(bin: string): boolean {
  try {
    execFileSync(pathLookupCommand(process.platform), [bin], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

export function buildInstallArgs(pkgManager: PackageManager, version: string): string[] {
  const specs = [
    `@earendil-works/pi-coding-agent@${version}`,
    `@earendil-works/pi-ai@${version}`,
    `@earendil-works/pi-tui@${version}`,
  ]
  if (pkgManager === 'npm') {
    return ['install', '--save-exact', '--ignore-scripts', '--no-audit', '--no-fund', ...specs]
  }
  if (pkgManager === 'pnpm') return ['add', '--save-exact', '--ignore-scripts', ...specs]
  if (pkgManager === 'yarn') return ['add', '--exact', '--ignore-scripts', ...specs]
  return ['add', '--exact', ...specs]
}
