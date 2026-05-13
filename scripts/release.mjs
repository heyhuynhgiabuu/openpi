#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/

function usage() {
  console.log(`OpenPi release helper

Usage:
  npm run release:patch -- --notes "Fixes and improvements"
  npm run release:minor -- --notes-file /tmp/openpi-release-notes.md
  npm run release:version -- 0.2.0-beta.0 --notes-file /tmp/openpi-release-notes.md

Options:
  --notes "text"          Release note bullet text. A leading "-" is optional.
  --notes-file <path>     Markdown notes to place under the new changelog entry.
  --preid <id>            Prerelease id for prerelease bumps. Default: beta.
  --skip-verify           Skip lint/typecheck/test/build.
  --dry-run               Print planned version and exit without writing files.
  -h, --help              Show this help.

What it does:
  1. Requires a clean git worktree.
  2. Bumps package.json and package-lock.json.
  3. Updates CHANGELOG.md.
  4. Runs npm run lint, typecheck, test, build unless --skip-verify is set.
  5. Commits chore(release): vX.Y.Z and creates annotated tag vX.Y.Z.
`)
}

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: 'inherit', ...options })
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function parseVersion(version) {
  const match = version.match(VERSION_RE)
  if (!match) throw new Error(`Invalid semver version: ${version}`)
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  }
}

function bumpVersion(current, bump, preid) {
  if (VERSION_RE.test(bump)) return bump

  const version = parseVersion(current)
  if (bump === 'major') return `${version.major + 1}.0.0`
  if (bump === 'minor') return `${version.major}.${version.minor + 1}.0`
  if (bump === 'patch') return `${version.major}.${version.minor}.${version.patch + 1}`

  if (bump === 'prerelease') {
    if (version.prerelease?.startsWith(`${preid}.`)) {
      const raw = version.prerelease.slice(preid.length + 1)
      const n = Number(raw)
      if (Number.isInteger(n))
        return `${version.major}.${version.minor}.${version.patch}-${preid}.${n + 1}`
    }
    return `${version.major}.${version.minor}.${version.patch + 1}-${preid}.0`
  }

  throw new Error(`Unsupported bump "${bump}". Use major, minor, patch, prerelease, or x.y.z.`)
}

function parseArgs(argv) {
  const args = {
    bump: 'patch',
    notes: null,
    notesFile: null,
    preid: 'beta',
    skipVerify: false,
    dryRun: false,
  }

  const rest = [...argv]
  if (rest[0] && !rest[0].startsWith('-')) args.bump = rest.shift()

  while (rest.length > 0) {
    const arg = rest.shift()
    if (arg === '--notes') args.notes = rest.shift() ?? ''
    else if (arg === '--notes-file') args.notesFile = rest.shift() ?? ''
    else if (arg === '--preid') args.preid = rest.shift() ?? 'beta'
    else if (arg === '--skip-verify') args.skipVerify = true
    else if (arg === '--dry-run') args.dryRun = true
    else if (arg === '-h' || arg === '--help') {
      usage()
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (args.notes && args.notesFile) throw new Error('Use either --notes or --notes-file, not both.')
  return args
}

function assertCleanWorktree() {
  const status = execFileSync('git', ['status', '--porcelain=v1'], { encoding: 'utf8' }).trim()
  if (status) {
    throw new Error('Release requires a clean git worktree. Commit or stash changes first.')
  }
}

function releaseNotes(args, version) {
  if (args.notesFile) return fs.readFileSync(path.resolve(args.notesFile), 'utf8').trim()
  if (args.notes) {
    const note = args.notes.trim()
    return note.startsWith('-') ? note : `- ${note}`
  }
  throw new Error(
    `Release notes are required for v${version}. Use --notes or --notes-file; placeholder changelog entries are not allowed.`
  )
}

function updateChangelog(version, notes) {
  const changelogPath = 'CHANGELOG.md'
  const today = new Date().toISOString().slice(0, 10)
  const entry = `## [${version}] - ${today}\n\n${notes.trim()}\n\n`

  if (!fs.existsSync(changelogPath)) {
    fs.writeFileSync(changelogPath, `# Changelog\n\n## [Unreleased]\n\n${entry}`)
    return
  }

  const current = fs.readFileSync(changelogPath, 'utf8')
  if (current.includes(`## [${version}]`)) throw new Error(`CHANGELOG.md already has ${version}`)
  if (!current.includes('## [Unreleased]')) {
    fs.writeFileSync(changelogPath, `${current.trim()}\n\n${entry}`)
    return
  }

  fs.writeFileSync(
    changelogPath,
    current.replace('## [Unreleased]\n', `## [Unreleased]\n\n${entry}`)
  )
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const packageJson = readJson('package.json')
  const nextVersion = bumpVersion(packageJson.version, args.bump, args.preid)
  const tag = `v${nextVersion}`

  if (args.dryRun) {
    console.log(`${packageJson.version} -> ${nextVersion}`)
    return
  }

  assertCleanWorktree()

  packageJson.version = nextVersion
  writeJson('package.json', packageJson)
  updateChangelog(nextVersion, releaseNotes(args, nextVersion))
  run('npm', ['install', '--package-lock-only', '--ignore-scripts'])

  if (!args.skipVerify) {
    run('npm', ['run', 'lint'])
    run('npm', ['run', 'typecheck'])
    run('npm', ['test'])
    run('npm', ['run', 'build'])
  }

  run('git', ['add', '--', 'package.json', 'package-lock.json', 'CHANGELOG.md'])
  run('git', ['commit', '-m', `chore(release): ${tag}`])
  run('git', ['tag', '-a', tag, '-m', `OpenPi ${tag}`])

  console.log(`\nCreated ${tag}. Push with:\n  git push origin main --follow-tags`)
}

try {
  main()
} catch (error) {
  console.error(`release failed: ${error.message}`)
  process.exit(1)
}
