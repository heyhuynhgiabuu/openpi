#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { createReadStream, existsSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const MAC_ARCHES = ['arm64', 'x64']

function quote(value) {
  return JSON.stringify(value)
}

export function renderMacUpdateMetadata(version, files) {
  if (!VERSION_RE.test(version)) throw new Error(`Invalid release version: ${version}`)
  if (files.length !== MAC_ARCHES.length) throw new Error('Both macOS ZIP artifacts are required')

  const byArch = new Map(
    MAC_ARCHES.map((arch) => [
      arch,
      files.find((file) => file.name === `OpenPi-${version}-${arch}.zip`),
    ])
  )
  for (const arch of MAC_ARCHES) {
    if (!byArch.get(arch)) throw new Error(`Missing ${arch} macOS ZIP metadata`)
  }

  const ordered = MAC_ARCHES.map((arch) => byArch.get(arch))
  const primary = ordered[0]
  if (!primary) throw new Error('Missing primary macOS ZIP metadata')

  const fileLines = ordered
    .map(
      (file) =>
        `  - url: ${quote(file.name)}\n    sha512: ${quote(file.sha512)}\n    size: ${file.size}`
    )
    .join('\n')

  return `version: ${quote(version)}\nfiles:\n${fileLines}\npath: ${quote(primary.name)}\nsha512: ${quote(primary.sha512)}\n`
}

async function sha512File(filePath) {
  const hash = createHash('sha512')
  const stream = createReadStream(filePath)
  for await (const chunk of stream) hash.update(chunk)
  return hash.digest('base64')
}

async function main() {
  const [version, artifactDirectory = 'dist-artifacts'] = process.argv.slice(2)
  if (!version || !VERSION_RE.test(version)) {
    throw new Error('Usage: node scripts/updateMetadata.mjs <version> [artifact-directory]')
  }

  const directory = resolve(artifactDirectory)
  const files = await Promise.all(
    MAC_ARCHES.map(async (arch) => {
      const name = `OpenPi-${version}-${arch}.zip`
      const filePath = resolve(directory, name)
      if (!existsSync(filePath)) throw new Error(`Missing macOS updater artifact: ${name}`)
      const size = statSync(filePath).size
      if (size <= 0) throw new Error(`Empty macOS updater artifact: ${name}`)
      return { name, sha512: await sha512File(filePath), size }
    })
  )

  const outputPath = resolve(directory, 'latest-mac.yml')
  writeFileSync(outputPath, renderMacUpdateMetadata(version, files))
  console.log(`Wrote ${outputPath} for arm64 and x64 macOS updates`)
}

const entrypoint = process.argv[1]
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  main().catch((error) => {
    console.error(`macOS update metadata failed: ${error.message}`)
    process.exit(1)
  })
}
