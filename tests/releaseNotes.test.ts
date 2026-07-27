import { describe, expect, it } from 'vitest'
import { updateChangelogText } from '../scripts/release.mjs'

describe('release changelog promotion', () => {
  it('moves the Unreleased body under the new version exactly once', () => {
    const current = `# Changelog

## [Unreleased]

### Added

- Intel builds

### Fixed

- Provider login

## [0.2.4] - 2026-06-30

- Previous release
`

    const result = updateChangelogText(
      current,
      '0.2.5',
      '2026-07-26',
      'OpenPi 0.2.5 updates Pi integration and macOS compatibility.'
    )

    expect(result).toContain(
      '## [Unreleased]\n\n## [0.2.5] - 2026-07-26\n\nOpenPi 0.2.5 updates Pi integration and macOS compatibility.\n\n### Added'
    )
    expect(result.match(/Intel builds/g)).toHaveLength(1)
    expect(result.match(/Provider login/g)).toHaveLength(1)
    expect(result.indexOf('## [0.2.5]')).toBeLessThan(result.indexOf('## [0.2.4]'))
  })

  it('does not duplicate release notes when the supplied notes match Unreleased', () => {
    const notes = '### Fixed\n\n- Provider login'
    const result = updateChangelogText(
      `# Changelog\n\n## [Unreleased]\n\n${notes}\n\n## [0.2.4] - 2026-06-30\n`,
      '0.2.5',
      '2026-07-26',
      notes
    )

    expect(result.match(/Provider login/g)).toHaveLength(1)
  })

  it('creates the new version when no Unreleased heading exists', () => {
    const result = updateChangelogText(
      '# Changelog\n\n## [0.2.4] - 2026-06-30\n',
      '0.2.5',
      '2026-07-26',
      '- Fixes and improvements'
    )

    expect(result).toContain('## [0.2.5] - 2026-07-26\n\n- Fixes and improvements')
  })
})
