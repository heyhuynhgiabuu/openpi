#!/usr/bin/env node
/**
 * Update the Homebrew tap cask to a new OpenPi release.
 *
 * Usage (local developer):
 *   node scripts/update-brew.mjs 0.1.9
 *   node scripts/update-brew.mjs v0.1.9 /path/to/OpenPi-0.1.9-arm64.dmg /path/to/OpenPi-0.1.9-x64.dmg
 *
 * Usage (CI — called from release.yml after artifacts are downloaded):
 *   BREW_TAP_TOKEN=<pat> node scripts/update-brew.mjs v0.1.9 dist-artifacts/OpenPi-0.1.9-arm64.dmg dist-artifacts/OpenPi-0.1.9-x64.dmg
 *
 * Required env:
 *   BREW_TAP_TOKEN  — GitHub PAT with contents:write on heyhuynhgiabuu/homebrew-openpi
 *                     (create at https://github.com/settings/tokens)
 */

import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { pipeline } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'

const OWNER = 'heyhuynhgiabuu'
const TAP_REPO = 'homebrew-openpi'
const CASK_PATH = 'Casks/openpi.rb'

function stripV(version) {
  return version.replace(/^v/, '')
}

async function sha256File(filePath) {
  const hash = createHash('sha256')
  const stream = createReadStream(filePath)
  await new Promise((resolve, reject) => {
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', resolve)
    stream.on('error', reject)
  })
  return hash.digest('hex')
}

async function downloadFile(url, destPath) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'openpi-release-script' },
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`Download failed ${res.status}: ${url}`)
  const writer = createWriteStream(destPath)
  await pipeline(res.body, writer)
}

async function githubApi(method, path, body, token) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json()
  if (!res.ok)
    throw new Error(`GitHub API ${method} ${path} → ${res.status}: ${JSON.stringify(data)}`)
  return data
}

export function renderCask(version, arm64Sha256, x64Sha256) {
  return `cask "openpi" do
  version "${version}"

  on_arm do
    sha256 "${arm64Sha256}"
    url "https://github.com/${OWNER}/openpi/releases/download/v#{version}/OpenPi-#{version}-arm64.dmg"
  end

  on_intel do
    sha256 "${x64Sha256}"
    url "https://github.com/${OWNER}/openpi/releases/download/v#{version}/OpenPi-#{version}-x64.dmg"
  end

  name "OpenPi"
  desc "Desktop workbench for the Pi coding agent"
  homepage "https://github.com/${OWNER}/openpi"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: :big_sur

  app "OpenPi.app"

  zap trash: [
    "~/Library/Application Support/OpenPi",
    "~/Library/Application Support/openpi",
    "~/Library/Logs/OpenPi",
    "~/Library/Preferences/dev.openpi.app.plist",
    "~/Library/Saved Application State/dev.openpi.app.savedState",
  ]

  caveats <<~EOS
    OpenPi beta builds are currently unsigned, so macOS may block first launch.
    If blocked, remove quarantine manually:
      xattr -rd com.apple.quarantine /Applications/OpenPi.app
  EOS
end
`
}

async function resolveDmgPath(version, arch, localDmg) {
  if (localDmg) {
    if (!existsSync(localDmg)) throw new Error(`${arch} DMG not found: ${localDmg}`)
    console.log(`Using local ${arch} DMG: ${localDmg}`)
    return localDmg
  }

  const filename = `OpenPi-${version}-${arch}.dmg`
  const url = `https://github.com/${OWNER}/openpi/releases/download/v${version}/${filename}`
  const dmgPath = join(tmpdir(), filename)
  if (existsSync(dmgPath)) {
    console.log(`Using cached ${arch} DMG: ${dmgPath}`)
    return dmgPath
  }

  console.log(`Downloading ${url} …`)
  await downloadFile(url, dmgPath)
  console.log(`Downloaded ${arch} DMG to ${dmgPath}`)
  return dmgPath
}

async function main() {
  const args = process.argv.slice(2)
  if (!args[0]) {
    console.error('Usage: node scripts/update-brew.mjs <version> [arm64-dmg-path x64-dmg-path]')
    process.exit(1)
  }
  if ((args[1] && !args[2]) || (!args[1] && args[2])) {
    console.error('Provide both local macOS DMGs or neither.')
    process.exit(1)
  }

  const version = stripV(args[0])
  const arm64Dmg = args[1]
  const x64Dmg = args[2]
  const token = process.env.BREW_TAP_TOKEN
  if (!token) {
    console.error(`
BREW_TAP_TOKEN is not set. Create a GitHub PAT with contents:write on
heyhuynhgiabuu/homebrew-openpi and export it:

  export BREW_TAP_TOKEN=ghp_...
  node scripts/update-brew.mjs ${version}

To enable automatic updates in CI, add BREW_TAP_TOKEN as a repository
secret at https://github.com/heyhuynhgiabuu/openpi/settings/secrets/actions
`)
    process.exit(1)
  }

  const [arm64DmgPath, x64DmgPath] = await Promise.all([
    resolveDmgPath(version, 'arm64', arm64Dmg),
    resolveDmgPath(version, 'x64', x64Dmg),
  ])

  console.log('Computing SHA256 checksums…')
  const [arm64Sha256, x64Sha256] = await Promise.all([
    sha256File(arm64DmgPath),
    sha256File(x64DmgPath),
  ])

  console.log(`Fetching current cask from ${OWNER}/${TAP_REPO}…`)
  const { sha: fileSha, content: encodedContent } = await githubApi(
    'GET',
    `/repos/${OWNER}/${TAP_REPO}/contents/${CASK_PATH}`,
    undefined,
    token
  )
  const currentContent = Buffer.from(encodedContent, 'base64').toString('utf8')
  const newContent = renderCask(version, arm64Sha256, x64Sha256)

  if (newContent === currentContent) {
    console.log(`Cask is already at v${version} — nothing to update.`)
    return
  }

  console.log(`Updating cask to v${version}…`)
  const { commit } = await githubApi(
    'PUT',
    `/repos/${OWNER}/${TAP_REPO}/contents/${CASK_PATH}`,
    {
      message: `chore: update openpi cask to v${version}`,
      content: Buffer.from(newContent).toString('base64'),
      sha: fileSha,
    },
    token
  )

  console.log(`✓ Cask updated → ${commit.sha.slice(0, 12)}`)
  console.log(`  https://github.com/${OWNER}/${TAP_REPO}/blob/main/${CASK_PATH}`)
}

const entrypoint = process.argv[1]
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  main().catch((err) => {
    console.error(`update-brew failed: ${err.message}`)
    process.exit(1)
  })
}
