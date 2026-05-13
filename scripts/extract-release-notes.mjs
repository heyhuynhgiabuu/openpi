#!/usr/bin/env node
import fs from 'node:fs'

const versionArg = process.argv[2]
if (!versionArg) {
  console.error('usage: node scripts/extract-release-notes.mjs <version-or-tag> [output]')
  process.exit(1)
}

const version = versionArg.replace(/^refs\/tags\//, '').replace(/^v/, '')
const outputPath = process.argv[3] ?? 'release-notes.generated.md'
const changelog = fs.readFileSync('CHANGELOG.md', 'utf8')
const heading = `## [${version}]`
const start = changelog.indexOf(heading)

if (start < 0) {
  console.error(`Could not find CHANGELOG.md section for ${heading}`)
  process.exit(1)
}

const next = changelog.indexOf('\n## [', start + heading.length)
const section = changelog.slice(start, next < 0 ? changelog.length : next).trim()
const lines = section.split('\n')
const title = lines[0].replace(/^## \[([^\]]+)\](.*)$/, '# OpenPi v$1$2')
const body = [title, ...lines.slice(1)].join('\n').trimEnd() + '\n'

fs.writeFileSync(outputPath, body)
console.log(`Wrote ${outputPath} from CHANGELOG.md ${heading}`)
