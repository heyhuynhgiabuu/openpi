import { describe, expect, it } from 'vitest'
import { generateCommitMessage } from '../electron/git/gitCommitMessage'
import type { GitChangedFile } from '../src/lib/ipc'

/**
 * Contract: `generateCommitMessage` turns the staged file list (plus the last
 * assistant message as `agentContext`) into a conventional-commits subject.
 * These assertions pin the literal messages a user sees in the commit box.
 */

function changed(
  path: string,
  status: GitChangedFile['status'] = 'M',
  staged = true
): GitChangedFile {
  return { path, status, staged, added: 0, removed: 0 }
}

describe('generateCommitMessage — subject', () => {
  it('returns an empty message when nothing is staged', () => {
    expect(generateCommitMessage([], undefined)).toBe('')
  })

  it('names a single modified file', () => {
    expect(generateCommitMessage([changed('electron/git/gitHost.ts')], undefined)).toBe(
      'fix(git): update gitHost.ts'
    )
  })

  it('uses the status for single-file verbs', () => {
    expect(generateCommitMessage([changed('electron/pi/sidecar.ts', 'A')], undefined)).toBe(
      'feat(sidecar): add sidecar.ts'
    )
    expect(generateCommitMessage([changed('electron/pi/sidecar.ts', 'D')], undefined)).toBe(
      'chore(sidecar): remove sidecar.ts'
    )
    expect(generateCommitMessage([changed('electron/pi/sidecar.ts', 'R')], undefined)).toBe(
      'refactor(sidecar): rename sidecar.ts'
    )
  })

  it('summarises adds by name and counts mixed statuses', () => {
    expect(
      generateCommitMessage(
        [changed('src/lib/a.ts', 'A'), changed('src/lib/b.ts', 'A'), changed('src/lib/c.ts', 'A')],
        undefined
      )
    ).toBe('feat(lib): add a.ts, b.ts and 1 more')

    expect(
      generateCommitMessage(
        [changed('src/lib/a.ts', 'A'), changed('src/lib/b.ts', 'M'), changed('src/lib/c.ts', 'D')],
        undefined
      )
    ).toBe('refactor(lib): add 1 file, update 1 file, remove 1 file')

    // A rename is not an add, so the name list must not stand in for both.
    expect(
      generateCommitMessage([changed('src/lib/a.ts', 'A'), changed('src/lib/c.ts', 'R')], undefined)
    ).toBe('feat(lib): add 1 file, rename 1 file')
    expect(
      generateCommitMessage([changed('src/lib/a.ts', 'D'), changed('src/lib/c.ts', 'R')], undefined)
    ).toBe('chore(lib): remove 1 file, rename 1 file')

    // A conflicted file is never presented as an add or a removal, so the name
    // list must not stand in when an `others` file is present.
    expect(
      generateCommitMessage([changed('src/lib/a.ts', 'A'), changed('src/B.tsx', 'U')], undefined)
    ).toBe('feat(lib): add 1 file, update 1 file')
    expect(
      generateCommitMessage([changed('src/lib/a.ts', 'D'), changed('src/B.tsx', 'U')], undefined)
    ).toBe('chore(lib): update 1 file, remove 1 file')

    // Two adds still read as a name list.
    expect(
      generateCommitMessage([changed('src/lib/a.ts', 'A'), changed('src/lib/b.ts', 'A')], undefined)
    ).toBe('feat(lib): add a.ts and b.ts')
  })

  it('names a single file that matches no status bucket', () => {
    // A staged conflict ('U') matches no bucket: without this the subject ended
    // at the colon.
    expect(generateCommitMessage([changed('src/App.tsx', 'U')], undefined)).toBe(
      'refactor(renderer): update App.tsx'
    )
  })

  it('counts conflicted files alongside modified ones', () => {
    expect(
      generateCommitMessage([changed('src/App.tsx', 'M'), changed('src/B.tsx', 'U')], undefined)
    ).toBe('fix(renderer): update 2 files')
    expect(
      generateCommitMessage([changed('src/App.tsx', 'U'), changed('src/B.tsx', 'U')], undefined)
    ).toBe('refactor(renderer): update 2 files')
    expect(
      generateCommitMessage([changed('src/App.tsx', '?'), changed('src/B.tsx', '?')], undefined)
    ).toBe('refactor(renderer): update 2 files')
  })

  it('does not end a path with a slash in an empty name', () => {
    expect(generateCommitMessage([changed('weird/')], undefined)).toBe('fix: update weird')
  })
})

describe('generateCommitMessage — type detection', () => {
  it('labels real test files as test', () => {
    expect(
      generateCommitMessage([changed('tests/a.test.ts'), changed('tests/b.test.ts')], undefined)
    ).toBe('test(tests): update 2 files')

    expect(generateCommitMessage([changed('tests/e2e/smoke.spec.ts')], undefined)).toBe(
      'test(tests): update smoke.spec.ts'
    )

    expect(generateCommitMessage([changed('src/test/setup.ts')], undefined)).toBe(
      'test(renderer): update setup.ts'
    )
  })

  it('does not read "test"/"spec" inside ordinary names as a test file', () => {
    // Substring matching labelled these `test(main)` / `test(lib)`.
    expect(generateCommitMessage([changed('electron/services/latestStatus.ts')], undefined)).toBe(
      'fix(main): update latestStatus.ts'
    )
    expect(generateCommitMessage([changed('src/lib/inspector.ts')], undefined)).toBe(
      'fix(lib): update inspector.ts'
    )
  })

  it('does not label a mixed change as test', () => {
    expect(
      generateCommitMessage(
        [changed('tests/a.test.ts'), changed('src/lib/inspector.ts')],
        undefined
      )
    ).toBe('fix(tests): update 2 files')
  })

  it('detects docs and style from extensions and directories', () => {
    expect(generateCommitMessage([changed('docs/setup')], undefined)).toBe('docs: update setup')
    expect(generateCommitMessage([changed('src/theme/main.scss')], undefined)).toBe(
      'style(renderer): update main.scss'
    )
    expect(generateCommitMessage([changed('src/theme/main.sass')], undefined)).toBe(
      'style(renderer): update main.sass'
    )
    // A markdown fixture under tests/ is still a test change.
    expect(generateCommitMessage([changed('tests/fixtures/pi-task-TASKS.md')], undefined)).toBe(
      'test(tests): update pi-task-TASKS.md'
    )
  })

  it('detects docs, style, ci and build from paths', () => {
    expect(generateCommitMessage([changed('docs/x.md')], undefined)).toBe('docs: update x.md')
    expect(generateCommitMessage([changed('src/index.css')], undefined)).toBe(
      'style(renderer): update index.css'
    )
    expect(generateCommitMessage([changed('.gitignore')], undefined)).toBe('ci: update .gitignore')
    expect(generateCommitMessage([changed('.github/workflows/ci.yml')], undefined)).toBe(
      'ci(ci): update ci.yml'
    )
    expect(generateCommitMessage([changed('scripts/release.mjs')], undefined)).toBe(
      'ci(scripts): update release.mjs'
    )
    expect(generateCommitMessage([changed('.githooks/pre-commit')], undefined)).toBe(
      'ci: update pre-commit'
    )
    expect(generateCommitMessage([changed('.vscode/settings.json')], undefined)).toBe(
      'ci: update settings.json'
    )
    expect(generateCommitMessage([changed('package.json')], undefined)).toBe(
      'build: update package.json'
    )
    // `vitest.config.ts` contains "test" but is build tooling, not a test file.
    expect(generateCommitMessage([changed('vitest.config.ts')], undefined)).toBe(
      'build: update vitest.config.ts'
    )
    expect(generateCommitMessage([changed('tsconfig.json')], undefined)).toBe(
      'build: update tsconfig.json'
    )
    expect(generateCommitMessage([changed('electron.vite.config.ts')], undefined)).toBe(
      'build: update electron.vite.config.ts'
    )
    expect(generateCommitMessage([changed('electron-builder.json')], undefined)).toBe(
      'build: update electron-builder.json'
    )
  })

  it('scopes project Pi resources as pi instead of ci', () => {
    // The root-dotfile ci rule used to swallow every `.pi/**` path.
    expect(generateCommitMessage([changed('.pi/extensions/openpi-bridge.ts')], undefined)).toBe(
      'fix(pi): update openpi-bridge.ts'
    )
    expect(generateCommitMessage([changed('.pi/settings.json.example')], undefined)).toBe(
      'fix(pi): update settings.json.example'
    )
  })
})

describe('generateCommitMessage — scope detection', () => {
  it('takes the scope shared by the most staged files', () => {
    expect(
      generateCommitMessage(
        [changed('src/lib/a.ts'), changed('electron/b.ts'), changed('src/lib/c.ts')],
        undefined
      )
    ).toBe('fix(lib): update 3 files')
  })

  it('breaks a tie on the first staged file', () => {
    expect(
      generateCommitMessage([changed('electron/b.ts'), changed('src/lib/a.ts')], undefined)
    ).toBe('fix(main): update 2 files')
    expect(
      generateCommitMessage([changed('src/lib/a.ts'), changed('electron/b.ts')], undefined)
    ).toBe('fix(lib): update 2 files')
  })

  it('maps each renderer and main subtree to its scope', () => {
    expect(generateCommitMessage([changed('src/lib/ipc.ts')], undefined)).toBe(
      'fix(ipc): update ipc.ts'
    )
    expect(generateCommitMessage([changed('src/components/git/GitPanel.tsx')], undefined)).toBe(
      'fix(git): update GitPanel.tsx'
    )
    expect(
      generateCommitMessage([changed('src/components/customizations/SettingsPane.tsx')], undefined)
    ).toBe('fix(customizations): update SettingsPane.tsx')
    expect(generateCommitMessage([changed('src/components/session/Row.tsx')], undefined)).toBe(
      'fix(session): update Row.tsx'
    )
    expect(generateCommitMessage([changed('src/components/terminal/Pane.tsx')], undefined)).toBe(
      'fix(terminal): update Pane.tsx'
    )
    expect(generateCommitMessage([changed('src/components/Composer.tsx')], undefined)).toBe(
      'fix(renderer): update Composer.tsx'
    )
    expect(generateCommitMessage([changed('electron/services/ptyHost.ts')], undefined)).toBe(
      'fix(main): update ptyHost.ts'
    )
  })

  it('omits the scope when no rule matches', () => {
    expect(generateCommitMessage([changed('docs/x.md')], undefined)).toBe('docs: update x.md')
  })
})

describe('generateCommitMessage — agent context', () => {
  it('uses the agent summary and lists the staged files', () => {
    expect(
      generateCommitMessage([changed('src/App.tsx')], 'Rewire the composer. Then tidy the imports.')
    ).toBe('fix(renderer): Rewire the composer. Then tidy the imports.\n\nFiles: App.tsx')
  })

  it('joins two sentences with a single space', () => {
    // Each regex match keeps its leading whitespace, which produced "First.  Second.".
    expect(
      generateCommitMessage([changed('src/App.tsx')], 'First sentence. Second sentence. Third.')
    ).toBe('fix(renderer): First sentence. Second sentence.\n\nFiles: App.tsx')
  })

  it('caps the summary at 120 characters, leaving 120 intact', () => {
    const message = generateCommitMessage([changed('src/App.tsx')], `${'x'.repeat(200)}. end`)
    const subject = message.split('\n')[0] ?? ''
    const summary = subject.replace('fix(renderer): ', '')
    expect(summary).toHaveLength(120)
    expect(summary.endsWith('...')).toBe(true)

    // 120 characters is the last length kept verbatim; 121 is truncated.
    const exact = generateCommitMessage([changed('src/App.tsx')], `${'y'.repeat(119)}.`)
    const exactSummary = (exact.split('\n')[0] ?? '').replace('fix(renderer): ', '')
    expect(exactSummary).toHaveLength(120)
    expect(exactSummary.endsWith('...')).toBe(false)

    const over = generateCommitMessage([changed('src/App.tsx')], `${'y'.repeat(120)}.`)
    const overSummary = (over.split('\n')[0] ?? '').replace('fix(renderer): ', '')
    expect(overSummary).toHaveLength(120)
    expect(overSummary.endsWith('...')).toBe(true)
  })

  it('drops markdown code blocks and thinking blocks', () => {
    expect(
      generateCommitMessage(
        [changed('src/App.tsx')],
        '```ts\nconst a = 1\n```\nWire the new prop.\n\n<think>internal</think>'
      )
    ).toBe('fix(renderer): Wire the new prop.\n\nFiles: App.tsx')
  })

  it('falls back to the heuristic subject when nothing survives', () => {
    // A reply that is only a code block leaves no prose to summarise.
    expect(generateCommitMessage([changed('src/App.tsx')], '```ts\nconst a = 1\n```')).toBe(
      'fix(renderer): update App.tsx\n\nFiles: App.tsx'
    )
    expect(generateCommitMessage([changed('src/App.tsx')], '   ')).toBe(
      'fix(renderer): update App.tsx\n\nFiles: App.tsx'
    )
  })

  it('uses the first line when the context has no sentence punctuation', () => {
    expect(
      generateCommitMessage([changed('src/App.tsx')], 'tighten the parser\nmore detail here')
    ).toBe('fix(renderer): tighten the parser\n\nFiles: App.tsx')
  })
})
