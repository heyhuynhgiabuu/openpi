import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import packageManifest from '../package.json'

/**
 * brace-expansion < 5.0.12 is covered by GHSA-q2hr-2g5m-vwhr (quadratic-time
 * CPU DoS, `npm audit` range >=4.0.0 <5.0.12). Every manifest and lock that
 * pins the 5.x line must resolve to the first fixed release.
 */
const root = resolve(import.meta.dirname, '..')
const FIXED = '5.0.12'
const OVERRIDE_KEY = 'brace-expansion@>=5.0.0 <5.0.12'

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

describe('brace-expansion override', () => {
  it('pins the npm override to the first fixed 5.x release', () => {
    // SAFETY: package.json `overrides` is a flat package-spec → version map.
    const overrides = packageManifest.overrides as Record<string, string>
    expect(overrides[OVERRIDE_KEY]).toBe(FIXED)
    expect(Object.keys(overrides).filter((key) => key.startsWith('brace-expansion'))).toEqual([
      OVERRIDE_KEY,
    ])
  })

  it('pins the pnpm workspace override to the same fixed release', () => {
    const workspace = readRepoFile('pnpm-workspace.yaml')
    expect(workspace).toMatch(/^ {2}'brace-expansion@>=5\.0\.0 <5\.0\.12': 5\.0\.12$/m)
    expect(workspace).not.toMatch(/brace-expansion@>=5\.0\.0 <5\.0\.9/)
  })

  it('resolves the pnpm lock to the fixed release with no 5.0.9 leftovers', () => {
    const lock = readRepoFile('pnpm-lock.yaml')
    expect(lock).toMatch(/^ {2}brace-expansion@>=5\.0\.0 <5\.0\.12: 5\.0\.12$/m)
    expect(lock).not.toMatch(/brace-expansion@5\.0\.9/)
    expect(lock).not.toMatch(/brace-expansion: 5\.0\.9/)
  })

  it('resolves every npm lock entry in the 5.x line to the fixed release', () => {
    // SAFETY: package-lock.json is npm lockfile v3; only `packages[*].version` is read.
    const lock = JSON.parse(readRepoFile('package-lock.json')) as {
      packages: Record<string, { version?: string }>
    }
    const braceEntries = Object.entries(lock.packages).filter(([key]) =>
      key.endsWith('node_modules/brace-expansion')
    )
    const fiveLine = braceEntries.filter(([, entry]) => entry.version?.startsWith('5.'))
    expect(fiveLine.length).toBeGreaterThan(0)
    for (const [key, entry] of fiveLine) {
      expect({ key, version: entry.version }).toEqual({ key, version: FIXED })
    }
  })
})
