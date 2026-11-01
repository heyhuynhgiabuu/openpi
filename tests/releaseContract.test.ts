import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderMacUpdateMetadata } from '../scripts/updateMetadata.mjs'
import { expectedMacNativePackages, hasMacArchitecture } from '../scripts/verifyMacPackage.mjs'

const root = resolve(import.meta.dirname, '..')
const releaseWorkflow = readFileSync(resolve(root, '.github/workflows/release.yml'), 'utf8')
const builderConfig = JSON.parse(
  readFileSync(resolve(root, 'electron-builder.json'), 'utf8')
) as Record<string, unknown>

function matrixEntry(name: string): string {
  const marker = `          - name: ${name}`
  const start = releaseWorkflow.indexOf(marker)
  if (start < 0) throw new Error(`Missing release matrix entry: ${name}`)
  const next = releaseWorkflow.indexOf('\n          - name:', start + marker.length)
  return releaseWorkflow.slice(start, next < 0 ? undefined : next)
}

describe('release artifact contract', () => {
  it('validates the tag version and uploads only that version directory', () => {
    expect(releaseWorkflow).toContain('package-lock.json')
    expect(releaseWorkflow).toContain('Tag version $VERSION does not match package metadata')
    expect(releaseWorkflow).toContain(`release/\${{ steps.release_meta.outputs.version }}/`)
    expect(releaseWorkflow).not.toContain('release/**/OpenPi')
    expect(releaseWorkflow).toContain('fail_on_unmatched_files: true')
  })

  it('requires exact installer names for every target architecture', () => {
    expect(builderConfig.artifactName).toBe(`\${productName}-\${version}-\${arch}.\${ext}`)
    expect(releaseWorkflow).toContain(`OpenPi-$VERSION-\${{ matrix.artifactArch }}.$ext`)
    const expectedArches = [
      ['macOS ARM64', 'arm64', 'arm64'],
      ['macOS Intel', 'x64', 'x64'],
      ['Windows', 'x64', 'x64'],
      ['Linux', 'x64', 'x86_64'],
    ] as const
    for (const [name, buildArch, artifactArch] of expectedArches) {
      const entry = matrixEntry(name)
      expect(entry).toContain(`\n            arch: ${buildArch}\n`)
      expect(entry).toContain(`\n            artifactArch: ${artifactArch}\n`)
    }
  })

  it('never asks for a retired macOS runner image', () => {
    // macos-14 retires 2026-11-02, and before that its jobs were cancelled having run
    // zero steps (no runner assigned), which reddened every PR on a check that never
    // executed code. Pinned here so the label cannot come back silently.
    const ciWorkflow = readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8')
    for (const workflow of [releaseWorkflow, ciWorkflow]) {
      expect(workflow).not.toMatch(/^\s*(os|runs-on):.*\bmacos-14\b/m)
      expect(workflow).not.toMatch(/os: \[[^\]]*\bmacos-14\b/m)
    }

    // The two macOS data points must stay one arm64 and one x64.
    expect(matrixEntry('macOS ARM64')).toContain('\n            os: macos-15\n')
    expect(matrixEntry('macOS Intel')).toContain('\n            os: macos-15-intel\n')
  })

  it('verifies packaged macOS native dependencies match the target architecture', () => {
    expect(releaseWorkflow).toContain(
      `node scripts/verifyMacPackage.mjs "$VERSION" "\${{ matrix.arch }}"`
    )
    expect(expectedMacNativePackages('arm64')).toEqual([
      '@ff-labs/fff-bin-darwin-arm64',
      '@lydell/node-pty-darwin-arm64',
      '@yuuang/ffi-rs-darwin-arm64',
    ])
    expect(expectedMacNativePackages('x64')).toEqual([
      '@ff-labs/fff-bin-darwin-x64',
      '@lydell/node-pty-darwin-x64',
      '@yuuang/ffi-rs-darwin-x64',
    ])
    expect(hasMacArchitecture('Mach-O 64-bit bundle arm64', 'arm64')).toBe(true)
    expect(hasMacArchitecture('Mach-O 64-bit bundle x86_64', 'arm64')).toBe(false)
    expect(hasMacArchitecture('Mach-O 64-bit bundle x86_64', 'x64')).toBe(true)
  })

  it('can verify the release toolchain without publishing anything', () => {
    // `release.yml` used to be dispatchable only on a tag, so the only way to check a
    // runner image was to run a real release -- and re-dispatching an existing tag would
    // overwrite the release already published for it. A dry run builds, packages and
    // verifies every target while `publish` (the only job with a side effect) is skipped.
    const workflow = releaseWorkflow

    expect(workflow).toMatch(/dry_run:[\s\S]{0,120}type: boolean/)
    // Nothing may publish unless the dispatch asked for a real release, and a failed
    // build must never reach publish, so the condition cannot be an `always()` form.
    const publish = workflow.slice(workflow.indexOf('  publish:'))
    expect(publish).toMatch(/if: \$\{\{ inputs\.dry_run != true \}\}/)
    // A modifier that ignores `needs` would publish after a failed build.
    expect(publish).not.toMatch(/if:.*always\(/)
    expect(publish).toContain('needs: build')
    // A dry run has no tag, so the version has to come from the package metadata.
    expect(workflow).toContain('Dry run: using package.json version')
    // And it must be dispatchable on a branch, or there is no way to run it pre-tag.
    const dispatch = workflow.slice(workflow.indexOf('workflow_dispatch:'))
    expect(dispatch).toContain('- "main"')
  })

  it('creates one combined macOS updater manifest and does not merge per-arch manifests', () => {
    expect(builderConfig.mac).toMatchObject({ target: ['dmg', 'zip'] })
    expect(releaseWorkflow).toContain('rm -f "release/$VERSION/latest-mac.yml"')
    expect(releaseWorkflow).toContain('node scripts/updateMetadata.mjs "$VERSION" dist-artifacts')

    const metadata = renderMacUpdateMetadata('0.2.5', [
      { name: 'OpenPi-0.2.5-arm64.zip', sha512: 'arm-hash', size: 11 },
      { name: 'OpenPi-0.2.5-x64.zip', sha512: 'x64-hash', size: 12 },
    ])
    expect(metadata).toContain('OpenPi-0.2.5-arm64.zip')
    expect(metadata).toContain('OpenPi-0.2.5-x64.zip')
    expect(metadata).toContain('sha512: "arm-hash"')
    expect(metadata).toContain('sha512: "x64-hash"')
  })

  it('scopes the Homebrew token to only Homebrew steps', () => {
    // The publish job stays gated on a successful build and keeps its own runner; the
    // dry-run condition is asserted separately below.
    expect(releaseWorkflow).toMatch(
      /publish:\n    name: Publish GitHub release\n    needs: build\n(?:    #.*\n)*    if: .*\n    runs-on: ubuntu-latest\n    steps:/
    )
    expect(releaseWorkflow).toContain('id: brew_status')
    expect(
      releaseWorkflow.match(/BREW_TAP_TOKEN: \$\{\{ secrets\.BREW_TAP_TOKEN \}\}/g)
    ).toHaveLength(3)
  })
})
