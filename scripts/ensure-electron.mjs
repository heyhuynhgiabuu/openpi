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
    if (!fs.existsSync(pathTxt)) return false
    if (!fs.existsSync(executable)) {
      console.warn('[ensure-electron] executable missing:', executable)
      return false
    }
    try {
      fs.accessSync(executable, fs.constants.X_OK)
    } catch {
      console.warn('[ensure-electron] fixing executable permission on', executable)
      fs.chmodSync(executable, 0o755)
    }
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
    const v = spawnSync(executable, ['--no-sandbox', '--version'], {
      encoding: 'utf8',
      timeout: 20_000,
    })
    if (v.status !== 0) {
      console.warn(
        '[ensure-electron] --version check failed:',
        'status=' + v.status,
        'signal=' + v.signal,
        'stderr=' + (v.stderr ?? '').trim()
      )
    }
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

  // First attempt: use the existing cache or download fresh.
  // If validation later fails, we wipe the cache dir and retry once.
  if (!fs.existsSync(zipPath)) {
    zipPath = await downloadFresh({
      version,
      artifactName: 'electron',
      cacheRoot,
      checksums,
      platform,
      arch,
    })
  }

  // Run install + validate in a loop with at most one retry, so a corrupt
  // cached zip from a previous failed run does not brick the whole pipeline.
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    fs.rmSync(path.join(electronDir, 'dist'), { recursive: true, force: true })
    try {
      fs.unlinkSync(pathTxt)
    } catch {
      /* ok */
    }
    fs.mkdirSync(path.join(electronDir, 'dist'), { recursive: true })

    const distDir = path.join(electronDir, 'dist')
    try {
      fs.chmodSync(distDir, 0o755)
    } catch {
      /* ok */
    }
    const unzip = spawnSync('unzip', ['-q', zipPath, '-d', distDir], { stdio: 'inherit' })
    if (unzip.status !== 0) {
      const extractZip = (await import('extract-zip')).default
      try {
        await extractZip(zipPath, { dir: distDir })
      } catch (err) {
        console.error('[ensure-electron] extract failed (unzip + extract-zip):', err)
        if (attempt === 1) {
          console.warn('[ensure-electron] retrying with a fresh download')
          fs.rmSync(cacheDir, { recursive: true, force: true })
          zipPath = await downloadFresh({
            version,
            artifactName: 'electron',
            cacheRoot,
            checksums,
            platform,
            arch,
          })
          continue
        }
        process.exit(1)
      }
    }

    // Diagnostic: log what was extracted
    try {
      const entries = fs.readdirSync(distDir, { recursive: true, withFileTypes: true })
      const files = entries
        .filter((e) => e.isFile())
        .map((e) => path.join(e.path.slice(distDir.length + 1), e.name))
      console.log(
        '[ensure-electron] dist files (' + files.length + '):',
        files.slice(0, 20).join(', ')
      )
    } catch {
      /* ok */
    }

    fs.writeFileSync(pathTxt, platformPath)

    // Make the binary executable — unzip may not preserve the permission bit
    // on all CI runners (e.g. GitHub Actions Ubuntu 24.04).
    try {
      fs.chmodSync(executable, 0o755)
    } catch {
      /* binary may not exist yet if extraction failed */
    }

    if (looksInstalled()) {
      const ver = spawnSync(executable, ['--no-sandbox', '--version'], {
        encoding: 'utf8',
      })
      console.log('[ensure-electron] OK', ver.stdout?.trim())
      return
    }

    // Cached zip produced a binary that does not pass --version. Treat the
    // cache as corrupt and retry with a fresh download.
    if (attempt === 1) {
      console.warn('[ensure-electron] validation failed; retrying with a fresh download')
      fs.rmSync(cacheDir, { recursive: true, force: true })
      zipPath = await downloadFresh({
        version,
        artifactName: 'electron',
        cacheRoot,
        checksums,
        platform,
        arch,
      })
      continue
    }
    break
  }

  try {
    const entries = fs.readdirSync(path.join(electronDir, 'dist'), {
      recursive: true,
      withFileTypes: true,
    })
    console.error(
      '[ensure-electron] dist contents:',
      entries
        .filter((e) => e.isFile() || e.name === 'electron')
        .map((e) => e.name)
        .slice(0, 30)
        .join(', ')
    )
    if (fs.existsSync(executable)) {
      const stat = fs.statSync(executable)
      const mode = stat.mode.toString(8).slice(-3)
      console.error('[ensure-electron]', executable, 'exists, mode=' + mode)
    } else {
      console.error('[ensure-electron]', executable, 'MISSING')
    }
  } catch {
    /* ok */
  }
  console.error(
    '[ensure-electron] Still broken after extract. Delete',
    cacheDir,
    'and re-run npm install'
  )
  process.exit(1)
}

async function downloadFresh(opts) {
  const { downloadArtifact } = await import('@electron/get')
  try {
    return await downloadArtifact(opts)
  } catch (err) {
    console.error('[ensure-electron] download failed:', err)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('[ensure-electron]', err)
  process.exit(1)
})
