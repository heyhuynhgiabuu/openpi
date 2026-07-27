import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SUPPORTED_ARCHES = ['arm64', 'x64']
const NATIVE_PACKAGE_PREFIXES = [
  '@ff-labs/fff-bin-darwin',
  '@lydell/node-pty-darwin',
  '@yuuang/ffi-rs-darwin',
]

export function expectedMacNativePackages(arch) {
  if (!SUPPORTED_ARCHES.includes(arch)) {
    throw new Error(`Unsupported macOS architecture: ${arch}`)
  }
  return NATIVE_PACKAGE_PREFIXES.map((name) => `${name}-${arch}`)
}

export function hasMacArchitecture(description, arch) {
  if (!SUPPORTED_ARCHES.includes(arch)) return false
  const marker = arch === 'x64' ? 'x86_64' : 'arm64'
  return description.includes(marker)
}

function assertMachOArchitecture(path, arch) {
  const description = execFileSync('file', ['-b', path], { encoding: 'utf8' })
  if (!hasMacArchitecture(description, arch)) {
    const marker = arch === 'x64' ? 'x86_64' : 'arm64'
    throw new Error(`Expected ${path} to contain ${marker}; got: ${description.trim()}`)
  }
}

export function verifyMacPackage(version, arch, projectDir = process.cwd()) {
  const releaseDir = resolve(projectDir, 'release', version)
  const appDirName = arch === 'arm64' ? 'mac-arm64' : 'mac'
  const appDir = resolve(releaseDir, appDirName, 'OpenPi.app')
  const resourcesDir = resolve(appDir, 'Contents', 'Resources')
  const unpackedModules = resolve(resourcesDir, 'app.asar.unpacked', 'node_modules')

  if (!existsSync(appDir)) {
    throw new Error(`Missing packaged application: ${appDir}`)
  }

  const framework = resolve(
    appDir,
    'Contents',
    'Frameworks',
    'Electron Framework.framework',
    'Versions',
    'A',
    'Electron Framework'
  )
  assertMachOArchitecture(framework, arch)

  const nativeFiles = [
    resolve(unpackedModules, '@ff-labs', `fff-bin-darwin-${arch}`, 'libfff_c.dylib'),
    resolve(
      unpackedModules,
      '@lydell',
      `node-pty-darwin-${arch}`,
      'prebuilds',
      `darwin-${arch}`,
      'pty.node'
    ),
    resolve(unpackedModules, '@yuuang', `ffi-rs-darwin-${arch}`, `ffi-rs.darwin-${arch}.node`),
  ]

  for (const path of nativeFiles) {
    if (!existsSync(path)) {
      throw new Error(`Missing ${arch} native dependency: ${path}`)
    }
    assertMachOArchitecture(path, arch)
  }

  const oppositeArch = arch === 'arm64' ? 'x64' : 'arm64'
  for (const packageName of expectedMacNativePackages(oppositeArch)) {
    if (existsSync(resolve(unpackedModules, packageName))) {
      throw new Error(`Packaged application contains wrong-architecture dependency: ${packageName}`)
    }
  }

  const changelog = resolve(resourcesDir, 'CHANGELOG.md')
  if (!existsSync(changelog)) {
    throw new Error(`Missing packaged changelog: ${changelog}`)
  }

  return { appDir, nativeFiles }
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isCli) {
  const [version, arch] = process.argv.slice(2)
  if (!version || !arch) {
    console.error('Usage: node scripts/verifyMacPackage.mjs <version> <arm64|x64>')
    process.exit(1)
  }

  try {
    const result = verifyMacPackage(version, arch)
    console.log(`Verified ${arch} macOS package: ${result.appDir}`)
    for (const path of result.nativeFiles) console.log(`Verified native binary: ${path}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
