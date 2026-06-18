#!/usr/bin/env node
/**
 * Ensure the Electron binary is present (fixes "Electron uninstall" from electron-vite).
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const electronDir = path.join(root, 'node_modules', 'electron')

async function main() {
  if (!fs.existsSync(path.join(electronDir, 'install.js'))) {
    return
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(electronDir, 'package.json'), 'utf8'))
  const version = pkg.version

  const platform = process.env.npm_config_platform || os.platform()
  let arch = process.env.npm_config_arch || os.arch()
  if (platform === 'darwin' && arch === 'x64') {
    try {
      const out = spawnSync('sysctl', ['-in', 'sysctl.proc_translated'], { encoding: 'utf8' })
      if (out.stdout?.trim() === '1') arch = 'arm64'
    } catch {
      /* ignore */
    }
  }

  const platformPath =
    platform === 'darwin' || platform === 'mas'
      ? 'Electron.app/Contents/MacOS/Electron'
      : platform === 'win32'
        ? 'electron.exe'
        : 'electron'

  const executable = path.join(electronDir, 'dist', platformPath)
  const pathTxt = path.join(electronDir, 'path.txt')

  function looksInstalled() {
    if (!fs.existsSync(pathTxt) || !fs.existsSync(executable)) return false
    if (platform === 'darwin') {
      const fw = path.join(
        electronDir,
        'dist',
        'Electron.app',
        'Contents',
        'Frameworks',
        'Electron Framework.framework',
        'Electron Framework'
      )
      if (!fs.existsSync(fw)) return false
    }
    const v = spawnSync(executable, ['--version'], { encoding: 'utf8', timeout: 20_000 })
    return v.status === 0 && /^v\d/.test((v.stdout ?? '').trim())
  }

  if (looksInstalled()) {
    return
  }

  console.log('[ensure-electron] Installing or repairing Electron', version, platform, arch)

  fs.rmSync(path.join(electronDir, 'dist'), { recursive: true, force: true })
  try {
    fs.unlinkSync(pathTxt)
  } catch {
    /* ok */
  }
  fs.mkdirSync(path.join(electronDir, 'dist'), { recursive: true })

  const artifact = `electron-v${version}-${platform}-${arch}.zip`
  const cacheRoot =
    process.env.electron_config_cache || path.join(os.homedir(), 'Library', 'Caches', 'electron')
  const checksums = JSON.parse(fs.readFileSync(path.join(electronDir, 'checksums.json'), 'utf8'))
  const sha = checksums[artifact]
  if (!sha) {
    console.error('[ensure-electron] No checksum for', artifact)
    process.exit(1)
  }
  const cacheDir = path.join(cacheRoot, createHash('sha256').update(sha).digest('hex'))
  let zipPath = path.join(cacheDir, artifact)

  if (!fs.existsSync(zipPath)) {
    const { downloadArtifact } = await import('@electron/get')
    try {
      zipPath = await downloadArtifact({
        version,
        artifactName: 'electron',
        force: true,
        cacheRoot,
        checksums,
        platform,
        arch,
      })
    } catch (err) {
      console.error('[ensure-electron] download failed:', err)
      process.exit(1)
    }
  }

  const distDir = path.join(electronDir, 'dist')
  const unzip = spawnSync('unzip', ['-q', zipPath, '-d', distDir], { stdio: 'inherit' })
  if (unzip.status !== 0) {
    const extractZip = (await import('extract-zip')).default
    try {
      await extractZip(zipPath, { dir: distDir })
    } catch (err) {
      console.error('[ensure-electron] extract failed (unzip + extract-zip):', err)
      process.exit(1)
    }
  }

  fs.writeFileSync(pathTxt, platformPath)

  if (!looksInstalled()) {
    console.error(
      '[ensure-electron] Still broken after extract. Delete',
      cacheDir,
      'and re-run npm install'
    )
    process.exit(1)
  }

  const ver = spawnSync(executable, ['--version'], { encoding: 'utf8' })
  console.log('[ensure-electron] OK', ver.stdout?.trim())
}

main().catch((err) => {
  console.error('[ensure-electron]', err)
  process.exit(1)
})
