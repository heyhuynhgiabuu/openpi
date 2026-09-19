import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  getGitBranchDiff,
  getGitFileDiff,
  getGitStagedDiff,
  getGitStatus,
} from '../electron/git/gitDiffStatus'
import { createTestRepo, type TestRepo } from './helpers/gitRepo'

/**
 * Regression: with `color.ui=always` every line of a git patch carries an ANSI
 * prefix, no hunk header is recognised, and the per-file counts come out zero.
 * Patch-producing reads must pass `--no-color` so the renderer sees a plain
 * unified diff.
 *
 * `color.ui` is set in the repository config rather than `--color` on the
 * command line, matching the reported reproduction.
 */
const FILE = 'src/app.ts'
const ORIGINAL = ['line 1', 'original line 2', 'line 3', ''].join('\n')
const EDITED = ['line 1', 'edited line 2', 'line 3', ''].join('\n')
const ANSI = '\u001b['

describe('git patch reads with color.ui=always (integration)', () => {
  let repo: TestRepo

  beforeEach(async () => {
    repo = await createTestRepo({ [FILE]: ORIGINAL })
    await repo.git.addConfig('color.ui', 'always')
  })

  afterEach(() => {
    repo?.cleanup()
  })

  it('counts an unstaged modification without ANSI prefixes', async () => {
    repo.write(FILE, EDITED)

    const diff = await getGitFileDiff(repo.cwd, FILE, { scope: 'unstaged' })

    expect(diff.rawPatch).not.toContain(ANSI)
    expect(diff.rawPatch).toContain('@@')
    expect(diff.totalAdded).toBe(1)
    expect(diff.totalRemoved).toBe(1)
  })

  it('counts the default auto scope', async () => {
    repo.write(FILE, EDITED)

    const diff = await getGitFileDiff(repo.cwd, FILE)

    expect(diff.rawPatch).not.toContain(ANSI)
    expect(diff.totalAdded).toBe(1)
    expect(diff.totalRemoved).toBe(1)
  })

  it('falls back to the staged diff in auto scope', async () => {
    repo.write(FILE, EDITED)
    await repo.stage()

    const diff = await getGitFileDiff(repo.cwd, FILE)

    expect(diff.rawPatch).not.toContain(ANSI)
    expect(diff.totalAdded).toBe(1)
    expect(diff.totalRemoved).toBe(1)
  })

  it('reports per-file and total counts in the status read model', async () => {
    repo.write(FILE, EDITED)

    const status = await getGitStatus(repo.cwd)
    const file = status.files.find((f) => f.path === FILE)

    expect(file?.added).toBe(1)
    expect(file?.removed).toBe(1)
    expect(status.totalAdded).toBe(1)
    expect(status.totalRemoved).toBe(1)
  })

  it('counts a staged modification', async () => {
    repo.write(FILE, EDITED)
    await repo.stage()

    const diff = await getGitFileDiff(repo.cwd, FILE, { scope: 'staged' })

    expect(diff.rawPatch).not.toContain(ANSI)
    expect(diff.totalAdded).toBe(1)
    expect(diff.totalRemoved).toBe(1)
  })

  it('counts a branch-scoped modification', async () => {
    await repo.git.checkoutLocalBranch('feature')
    repo.write(FILE, EDITED)
    await repo.stage()
    await repo.commit('feature change')

    const diff = await getGitFileDiff(repo.cwd, FILE, { scope: 'branch', baseBranch: 'main' })

    expect(diff.rawPatch).not.toContain(ANSI)
    expect(diff.totalAdded).toBe(1)
    expect(diff.totalRemoved).toBe(1)
  })

  it('counts every file in the staged-diff map', async () => {
    repo.write(FILE, EDITED)
    await repo.stage()

    const staged = await getGitStagedDiff(repo.cwd)

    expect(staged?.[FILE]?.rawPatch).not.toContain(ANSI)
    expect(staged?.[FILE]?.totalAdded).toBe(1)
    expect(staged?.[FILE]?.totalRemoved).toBe(1)
  })

  it('counts every file in the branch-diff map', async () => {
    await repo.git.checkoutLocalBranch('feature')
    repo.write(FILE, EDITED)
    await repo.stage()
    await repo.commit('feature change')

    const branch = await getGitBranchDiff(repo.cwd, 'main')

    expect(branch?.[FILE]?.rawPatch).not.toContain(ANSI)
    expect(branch?.[FILE]?.totalAdded).toBe(1)
    expect(branch?.[FILE]?.totalRemoved).toBe(1)
  })
})
