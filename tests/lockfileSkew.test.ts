import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

/**
 * CI installs with `npm ci`, so package-lock.json is authoritative. Local pnpm
 * installs must resolve the same direct dependency versions, otherwise a change
 * validated against pnpm can fail CI (and vice versa). See CONTRIBUTING.md
 * ("Lockfiles").
 *
 * pnpm-lock.yaml is read with a small indentation-aware line parser instead of a
 * YAML library: `yaml` is only a transitive dependency and must not be imported.
 */
const root = resolve(import.meta.dirname, '..')

const MISSING = '(missing)'
const PNPM_DEP_GROUPS = new Set(['dependencies', 'devDependencies', 'optionalDependencies'])

const dependencyMapSchema = z.record(z.string())
const npmLockSchema = z.object({
  packages: z.record(
    z
      .object({
        version: z.string().optional(),
        dependencies: dependencyMapSchema.optional(),
        devDependencies: dependencyMapSchema.optional(),
        optionalDependencies: dependencyMapSchema.optional(),
      })
      .passthrough()
  ),
})

/** Direct dependency name -> resolved version. */
interface DirectVersions {
  [name: string]: string
}

interface VersionSkew {
  name: string
  npm: string
  pnpm: string
}

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

/** Resolved version of every direct dependency of the root project in package-lock.json. */
function parseNpmDirectVersions(lockText: string): DirectVersions {
  const lock = npmLockSchema.parse(JSON.parse(lockText))
  const rootEntry = lock.packages['']
  if (!rootEntry) throw new Error('package-lock.json has no root package entry ("")')
  const names = new Set([
    ...Object.keys(rootEntry.dependencies ?? {}),
    ...Object.keys(rootEntry.devDependencies ?? {}),
    ...Object.keys(rootEntry.optionalDependencies ?? {}),
  ])
  const versions: DirectVersions = {}
  for (const name of names) {
    versions[name] = lock.packages[`node_modules/${name}`]?.version ?? MISSING
  }
  return versions
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length
}

function isSignificant(line: string): boolean {
  const trimmed = line.trim()
  return trimmed !== '' && !trimmed.startsWith('#')
}

function unquote(value: string): string {
  const match = /^(['"])(.*)\1$/.exec(value)
  return match?.[2] ?? value
}

/** Split `key: value` where the key may be a quoted scoped name such as '@scope/pkg'. */
function splitKeyValue(line: string): { key: string; value: string } | undefined {
  const match = /^(?:'([^']+)'|"([^"]+)"|([^\s:'"][^:]*)):(?:\s+(.*))?$/.exec(line.trim())
  if (!match) return undefined
  return { key: match[1] ?? match[2] ?? match[3] ?? '', value: match[4]?.trim() ?? '' }
}

/** `1.2.11(@shikijs/themes@3.23.0)(react@19)` -> `1.2.11`. */
function stripPeerSuffix(version: string): string {
  const parenIndex = version.indexOf('(')
  return (parenIndex === -1 ? version : version.slice(0, parenIndex)).trim()
}

/** Lines belonging to `importers['.']`, i.e. everything nested under its key. */
function rootImporterLines(lines: string[]): string[] {
  const importersAt = lines.findIndex((line) => line === 'importers:')
  if (importersAt === -1) throw new Error('pnpm-lock.yaml has no top-level "importers:" section')
  const section: string[] = []
  let inRoot = false
  for (const line of lines.slice(importersAt + 1)) {
    if (!isSignificant(line)) continue
    const indent = indentOf(line)
    if (indent === 0) break
    if (indent === 2) {
      if (inRoot) break
      inRoot = splitKeyValue(line)?.key === '.'
      continue
    }
    if (inRoot) section.push(line)
  }
  if (section.length === 0) throw new Error('pnpm-lock.yaml has no importers["."] section')
  return section
}

/** Resolved (peer-suffix-free) version of every direct dependency in pnpm-lock.yaml. */
function parsePnpmDirectVersions(lockText: string): DirectVersions {
  const versions: DirectVersions = {}
  let group: string | undefined
  let current: string | undefined
  for (const line of rootImporterLines(lockText.split(/\r?\n/))) {
    const indent = indentOf(line)
    const pair = splitKeyValue(line)
    if (!pair) continue
    if (indent === 4) {
      group = PNPM_DEP_GROUPS.has(pair.key) ? pair.key : undefined
      current = undefined
    } else if (group && indent === 6) {
      current = pair.key
    } else if (group && current && indent === 8 && pair.key === 'version') {
      versions[current] = stripPeerSuffix(unquote(pair.value))
    }
  }
  if (Object.keys(versions).length === 0) {
    throw new Error('pnpm-lock.yaml importers["."] lists no resolved dependency versions')
  }
  return versions
}

function findVersionSkew(npm: DirectVersions, pnpm: DirectVersions): VersionSkew[] {
  const names = [...new Set([...Object.keys(npm), ...Object.keys(pnpm)])].sort()
  return names
    .map((name) => ({ name, npm: npm[name] ?? MISSING, pnpm: pnpm[name] ?? MISSING }))
    .filter((entry) => entry.npm !== entry.pnpm)
}

function formatSkewReport(skew: VersionSkew[]): string {
  const rows = skew.map(
    ({ name, npm, pnpm }) => `  ${name}: package-lock.json ${npm} != pnpm-lock.yaml ${pnpm}`
  )
  return [
    `${skew.length} direct dependenc${skew.length === 1 ? 'y resolves' : 'ies resolve'} to different versions in package-lock.json and pnpm-lock.yaml:`,
    ...rows,
    'package-lock.json is authoritative (CI runs `npm ci`). Re-align pnpm-lock.yaml: see CONTRIBUTING.md, "Lockfiles".',
  ].join('\n')
}

const PNPM_FIXTURE = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true

importers:

  .:
    dependencies:
      '@pierre/diffs':
        specifier: ^1.1.21
        version: 1.2.11(@shikijs/themes@3.23.0)(react@19.0.0)
      clsx:
        specifier: ^2.1.1
        version: 2.1.1
    devDependencies:
      vitest:
        specifier: ^3.1.3
        version: 3.2.6(@types/node@22.15.29)(jsdom@26.1.0)
      oxlint:
        specifier: 1.81.0
        version: '1.81.0'

  packages/other:
    dependencies:
      other-only:
        specifier: ^9.0.0
        version: 9.9.9

packages:

  clsx@2.1.1:
    resolution: {integrity: sha512-x}
`

describe('parsePnpmDirectVersions', () => {
  it('reads dependencies and devDependencies of the root importer only', () => {
    expect(parsePnpmDirectVersions(PNPM_FIXTURE)).toEqual({
      '@pierre/diffs': '1.2.11',
      clsx: '2.1.1',
      vitest: '3.2.6',
      oxlint: '1.81.0',
    })
  })

  it('strips pnpm peer suffixes down to the bare version', () => {
    expect(stripPeerSuffix('1.2.11(@shikijs/themes@3.23.0)(react@19)')).toBe('1.2.11')
    expect(stripPeerSuffix('1.0.0-beta.12')).toBe('1.0.0-beta.12')
  })

  it('tolerates CRLF line endings', () => {
    expect(parsePnpmDirectVersions(PNPM_FIXTURE.replace(/\n/g, '\r\n')).clsx).toBe('2.1.1')
  })

  it('fails loudly instead of returning an empty map for an unrecognised layout', () => {
    expect(() => parsePnpmDirectVersions('lockfileVersion: 9.0\n')).toThrow(/importers/)
    expect(() => parsePnpmDirectVersions('importers:\n  other:\n    dependencies:\n')).toThrow(
      /importers\["."\]/
    )
  })
})

describe('findVersionSkew', () => {
  it('returns nothing when both locks agree', () => {
    expect(findVersionSkew({ a: '1.0.0', b: '2.0.0' }, { b: '2.0.0', a: '1.0.0' })).toEqual([])
  })

  it('names every differing package with both versions, sorted by name', () => {
    const skew = findVersionSkew(
      { zed: '1.0.0', '@pierre/diffs': '1.4.3', same: '1.0.0' },
      { zed: '1.0.1', '@pierre/diffs': '1.2.11', same: '1.0.0' }
    )
    expect(skew).toEqual([
      { name: '@pierre/diffs', npm: '1.4.3', pnpm: '1.2.11' },
      { name: 'zed', npm: '1.0.0', pnpm: '1.0.1' },
    ])
    const report = formatSkewReport(skew)
    expect(report).toContain('@pierre/diffs: package-lock.json 1.4.3 != pnpm-lock.yaml 1.2.11')
    expect(report).toContain('zed: package-lock.json 1.0.0 != pnpm-lock.yaml 1.0.1')
  })

  it('flags a dependency present in only one lock', () => {
    expect(findVersionSkew({ a: '1.0.0' }, {})).toEqual([
      { name: 'a', npm: '1.0.0', pnpm: MISSING },
    ])
    expect(findVersionSkew({}, { a: '1.0.0' })).toEqual([
      { name: 'a', npm: MISSING, pnpm: '1.0.0' },
    ])
  })
})

describe('npm and pnpm lockfile alignment', () => {
  const npmVersions = parseNpmDirectVersions(readRepoFile('package-lock.json'))
  const pnpmVersions = parsePnpmDirectVersions(readRepoFile('pnpm-lock.yaml'))

  it('parses a plausible number of direct dependencies from both locks', () => {
    expect(Object.keys(npmVersions).length).toBeGreaterThan(50)
    expect(Object.keys(pnpmVersions).sort()).toEqual(Object.keys(npmVersions).sort())
  })

  it('resolves every direct dependency to the same version in package-lock.json and pnpm-lock.yaml', () => {
    const skew = findVersionSkew(npmVersions, pnpmVersions)
    expect(skew, formatSkewReport(skew)).toEqual([])
  })

  it('detects a deliberately skewed pnpm-lock.yaml', () => {
    const lockText = readRepoFile('pnpm-lock.yaml')
    const skewedText = lockText.replace(
      /('@pierre\/diffs':\n\s+specifier: .*\n\s+version: )\S+/,
      (_match, prefix: string) => `${prefix}0.0.0-skewed`
    )
    expect(skewedText).not.toBe(lockText)
    expect(findVersionSkew(npmVersions, parsePnpmDirectVersions(skewedText))).toContainEqual({
      name: '@pierre/diffs',
      npm: npmVersions['@pierre/diffs'],
      pnpm: '0.0.0-skewed',
    })
  })
})
