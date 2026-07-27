import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderMacUpdateMetadata } from '../scripts/updateMetadata.mjs'

const root = resolve(import.meta.dirname, '..')
const releaseWorkflow = readFileSync(resolve(root, '.github/workflows/release.yml'), 'utf8')
const builderConfig = JSON.parse(
  readFileSync(resolve(root, 'electron-builder.json'), 'utf8')
) as Record<string, unknown>

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
    expect(releaseWorkflow).toContain(`OpenPi-$VERSION-\${{ matrix.arch }}.$ext`)
    expect(releaseWorkflow).toMatch(/name: macOS ARM64[\s\S]*extensions: "dmg zip"/)
    expect(releaseWorkflow).toMatch(/name: macOS Intel[\s\S]*extensions: "dmg zip"/)
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
    expect(releaseWorkflow).toContain(
      'publish:\n    name: Publish GitHub release\n    needs: build\n    runs-on: ubuntu-latest\n    steps:'
    )
    expect(releaseWorkflow).toContain('id: brew_status')
    expect(
      releaseWorkflow.match(/BREW_TAP_TOKEN: \$\{\{ secrets\.BREW_TAP_TOKEN \}\}/g)
    ).toHaveLength(3)
  })
})
