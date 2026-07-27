import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderCask } from '../scripts/update-brew.mjs'

const root = resolve(import.meta.dirname, '..')
const ciWorkflow = readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8')
const releaseWorkflow = readFileSync(resolve(root, '.github/workflows/release.yml'), 'utf8')
describe('Intel macOS release contract', () => {
  it('builds a dedicated Intel macOS installer and supplies both DMGs to the tap updater', () => {
    expect(releaseWorkflow).toMatch(/name: macOS Intel\s+os: macos-15-intel\s+arch: x64/)
    expect(releaseWorkflow).toContain(`--\${{ matrix.arch }}`)
    expect(releaseWorkflow).toContain('ARM64_DMG=$(find dist-artifacts -name "*-arm64.dmg"')
    expect(releaseWorkflow).toContain('X64_DMG=$(find dist-artifacts -name "*-x64.dmg"')
    expect(releaseWorkflow).toContain(
      `node scripts/update-brew.mjs "\${{ github.ref_name }}" "$ARM64_DMG" "$X64_DMG"`
    )
    expect(ciWorkflow).toContain('macos-15-intel')
  })

  it('renders a cask that selects a matching installer for each Mac architecture', () => {
    const cask = renderCask('0.3.0', 'arm-checksum', 'intel-checksum')

    expect(cask).toContain('on_arm do')
    expect(cask).toContain('sha256 "arm-checksum"')
    expect(cask).toContain('OpenPi-#{version}-arm64.dmg')
    expect(cask).toContain('on_intel do')
    expect(cask).toContain('sha256 "intel-checksum"')
    expect(cask).toContain('OpenPi-#{version}-x64.dmg')
    expect(cask).toContain('sha256 "arm-checksum"\n\n    url')
    expect(cask).toContain('sha256 "intel-checksum"\n\n    url')
    expect(cask).toContain('OpenPi-#{version}-arm64.dmg"\n  end\n  on_intel do')
    expect(cask).not.toContain('depends_on arch: :arm64')
  })
})
