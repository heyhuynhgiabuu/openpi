import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getGitBranchDiff,
  getGitFileDiff,
  getGitStagedDiff,
  getGitStatus,
  getWorkspaceSummary,
} from '../electron/git/gitDiffStatus'
import { getGitHistory, getGitRefs } from '../electron/git/gitHistory'
import { createBranch } from '../electron/git/gitMutations'
import { registerWorkspacesIpc } from '../electron/ipc/workspaces'
import { IPC } from '../src/lib/ipc'
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
type IpcHandler = (event: unknown, raw?: unknown) => unknown

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

describe('git branch and history reads with color.ui=always (integration)', () => {
  let repo: TestRepo

  beforeEach(async () => {
    repo = await createTestRepo({ [FILE]: ORIGINAL })
    await repo.git.addConfig('color.ui', 'always')
  })

  afterEach(() => {
    repo?.cleanup()
  })

  it('reports the current branch in the workspace summary', async () => {
    const summary = await getWorkspaceSummary(repo.cwd)

    expect(summary.branch).toBe('main')
  })

  it('returns the current branch from the GET_GIT_BRANCH handler', async () => {
    const handlers = new Map<string, IpcHandler>()
    const deps: Parameters<typeof registerWorkspacesIpc>[0] = {
      ipcMain: {
        handle: vi.fn((channel: string, handler: IpcHandler) => handlers.set(channel, handler)),
      } as unknown as Parameters<typeof registerWorkspacesIpc>[0]['ipcMain'],
      getCwd: () => repo.cwd,
      getGitHost: vi.fn(),
      getSessionIndex: () => null,
      getCustomizationsHost: vi.fn(),
      getAgentDir: () => '/agent',
      confirmHighRiskMutation: vi.fn(),
    }
    registerWorkspacesIpc(deps)
    const handler = handlers.get(IPC.GET_GIT_BRANCH)
    if (!handler) throw new Error('Expected GET_GIT_BRANCH handler')

    const result = await handler({}, { cwd: repo.cwd })

    expect(result).toEqual({ branch: 'main' })
  })

  it('lists refs with correct current and remote flags', async () => {
    await repo.git.raw(['update-ref', 'refs/remotes/origin/main', 'HEAD'])

    const refs = await getGitRefs(repo.cwd)

    const byName = new Map(refs.branches.map((b) => [b.name, b]))
    const current = byName.get('main')
    const remote = byName.get('remotes/origin/main')
    expect(current).toBeDefined()
    expect(remote).toBeDefined()
    expect(current?.current).toBe(true)
    expect(current?.remote).toBe(false)
    expect(remote?.remote).toBe(true)
    expect(remote?.current).toBe(false)
    expect(refs.branches.filter((b) => b.current)).toHaveLength(1)
    expect(refs.branches.every((b) => !b.name.includes(ANSI))).toBe(true)
  })

  it('parses graph rows and commits without ANSI pollution', async () => {
    await repo.git.checkoutLocalBranch('feature')
    repo.write('feature.txt', 'feature\n')
    await repo.stage()
    await repo.commit('feature commit')
    await repo.git.checkout(['main'])
    repo.write('main.txt', 'main\n')
    await repo.stage()
    await repo.commit('main commit')
    await repo.git.merge(['--no-ff', 'feature', '-m', 'merge commit'])

    const { graphRows, commits } = await getGitHistory(repo.cwd)

    const merge = commits.find((c) => c.message === 'merge commit')
    expect(merge?.hash).toMatch(/^[0-9a-f]{40}$/)
    expect(merge?.graph).not.toContain(ANSI)
    const mergeRow = graphRows.find((row) => row.commitHash === merge?.hash)
    expect(mergeRow?.columns).toEqual([{ col: 0, char: '*' }])

    // A --no-ff merge always draws lane scaffolding on some continuation row.
    const continuations = graphRows.filter((row) => !row.commitHash)
    expect(continuations.length).toBeGreaterThan(0)
    for (const row of graphRows) {
      for (const column of row.columns) {
        expect(column.char).toMatch(/^[*|\\/_]$/)
      }
    }
  })

  it('detects an existing branch when creating a duplicate', async () => {
    const duplicate = await createBranch(repo.cwd, 'main')

    expect(duplicate.ok).toBe(false)
    expect(duplicate.output).toContain('already exists')

    const fresh = await createBranch(repo.cwd, 'color-test-branch')
    expect(fresh.ok).toBe(true)
  })
})
