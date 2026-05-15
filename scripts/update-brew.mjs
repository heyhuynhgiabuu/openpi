#!/usr/bin/env node
/**
 * Update the Homebrew tap cask to a new OpenPi release.
 *
 * Usage (local developer):
 *   node scripts/update-brew.mjs 0.1.9
 *   node scripts/update-brew.mjs v0.1.9 /path/to/OpenPi-0.1.9-arm64.dmg
 *
 * Usage (CI — called from release.yml after artifacts are downloaded):
 *   BREW_TAP_TOKEN=<pat> node scripts/update-brew.mjs v0.1.9 dist-artifacts/OpenPi-0.1.9-arm64.dmg
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

const OWNER = 'heyhuynhgiabuu'
const TAP_REPO = 'homebrew-openpi'
const CASK_PATH = 'Casks/openpi.rb'

// ─── helpers ────────────────────────────────────────────────────────────────

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

// ─── main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  if (!args[0]) {
    console.error('Usage: node scripts/update-brew.mjs <version> [dmg-path]')
    process.exit(1)
  }

  const version = stripV(args[0])
  const localDmg = args[1]

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

  // ── 1. Resolve DMG path ───────────────────────────────────────────────────
  let dmgPath = localDmg
  if (dmgPath) {
    if (!existsSync(dmgPath)) throw new Error(`DMG not found: ${dmgPath}`)
    console.log(`Using local DMG: ${dmgPath}`)
  } else {
    const url = `https://github.com/${OWNER}/openpi/releases/download/v${version}/OpenPi-${version}-arm64.dmg`
    dmgPath = join(tmpdir(), `OpenPi-${version}-arm64.dmg`)
    if (existsSync(dmgPath)) {
      console.log(`Using cached DMG: ${dmgPath}`)
    } else {
      console.log(`Downloading ${url} …`)
      await downloadFile(url, dmgPath)
      console.log(`Downloaded to ${dmgPath}`)
    }
  }

  // ── 2. Compute SHA256 ─────────────────────────────────────────────────────
  console.log('Computing SHA256…')
  const sha256 = await sha256File(dmgPath)
  console.log(`SHA256: ${sha256}`)

  // ── 3. Fetch current cask from tap ────────────────────────────────────────
  console.log(`Fetching current cask from ${OWNER}/${TAP_REPO}…`)
  const { sha: fileSha, content: encodedContent } = await githubApi(
    'GET',
    `/repos/${OWNER}/${TAP_REPO}/contents/${CASK_PATH}`,
    undefined,
    token
  )
  const currentContent = Buffer.from(encodedContent, 'base64').toString('utf8')

  // ── 4. Patch version and sha256 ───────────────────────────────────────────
  const newContent = currentContent
    .replace(/version "[^"]+"/, `version "${version}"`)
    .replace(/sha256 "[^"]+"/, `sha256 "${sha256}"`)

  if (newContent === currentContent) {
    console.log(`Cask is already at v${version} — nothing to update.`)
    return
  }

  // ── 5. Commit to tap via API (no clone needed) ────────────────────────────
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

main().catch((err) => {
  console.error(`update-brew failed: ${err.message}`)
  process.exit(1)
})
