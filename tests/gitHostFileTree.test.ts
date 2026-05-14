import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  checkoutBranch,
  commitFiles,
  generateCommitMessage,
  getFileTree,
  getGitHistory,
  getGitRefs,
  getGitStatus,
  syncRemote,
} from '../electron/gitHost'
import {
  gitCheckoutBranchResultSchema,
  gitHistoryResultSchema,
  gitRefsResultSchema,
  gitStatusResultSchema,
  gitSyncResultSchema,
} from '../src/lib/ipc'

// Pin git identity env vars for every git operation in this file.
// Environment variables take highest priority over .git/config, so an empty
// GIT_AUTHOR_NAME on a CI runner would override initRepo's local config and
// cause "fatal: empty ident name" failures. Setting them here makes the tests
// hermetic against whatever identity the CI environment provides.
process.env.GIT_AUTHOR_NAME = 'OpenPi Test'
process.env.GIT_AUTHOR_EMAIL = 'openpi@example.com'
process.env.GIT_COMMITTER_NAME = 'OpenPi Test'
process.env.GIT_COMMITTER_EMAIL = 'openpi@example.com'

let tmp: string | null = null

function makeWorkspace(): string {
  tmp = mkdtempSync(join(tmpdir(), 'openpi-file-tree-'))
  return tmp
}

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function initRepo(cwd: string): void {
  runGit(cwd, ['init', '-b', 'main'])
  runGit(cwd, ['config', 'user.email', 'openpi@example.com'])
  runGit(cwd, ['config', 'user.name', 'OpenPi Test'])
}

function commitPaths(cwd: string, message: string, paths: string[]): void {
  runGit(cwd, ['add', '--', ...paths])
  runGit(cwd, ['commit', '-m', message])
}

function flattenTreePaths(tree: ReturnType<typeof getFileTree>): string[] {
  const paths: string[] = []

  const visit = (nodes: typeof tree.children) => {
    for (const node of nodes) {
      paths.push(node.path)
      if (node.children) visit(node.children)
    }
  }

  visit(tree.children)
  return paths
}

afterEach(() => {
  if (tmp) {
    rmSync(tmp, { recursive: true, force: true })
    tmp = null
  }
})

describe('getFileTree', () => {
  it('includes local files below the old three-level cutoff', () => {
    const cwd = makeWorkspace()
    mkdirSync(join(cwd, 'a/b/c/d/e'), { recursive: true })
    writeFileSync(join(cwd, 'a/b/c/d/e/deep.txt'), 'deep')

    expect(flattenTreePaths(getFileTree(cwd))).toContain('a/b/c/d/e/deep.txt')
  })

  it('excludes ignored dependency and build directories', () => {
    const cwd = makeWorkspace()
    mkdirSync(join(cwd, 'node_modules/pkg'), { recursive: true })
    mkdirSync(join(cwd, 'src'), { recursive: true })
    writeFileSync(join(cwd, 'node_modules/pkg/index.js'), 'ignored')
    writeFileSync(join(cwd, 'src/index.ts'), 'included')

    const paths = flattenTreePaths(getFileTree(cwd))
    expect(paths).toContain('src/index.ts')
    expect(paths).not.toContain('node_modules')
    expect(paths).not.toContain('node_modules/pkg/index.js')
  })
})

describe('getGitStatus', () => {
  it('reports branch, upstream, stash, staged, unstaged, and untracked state', async () => {
    const root = makeWorkspace()
    const repo = join(root, 'repo')
    const remote = join(root, 'remote.git')
    mkdirSync(repo)

    initRepo(repo)
    writeFileSync(join(repo, 'README.md'), 'initial\n')
    commitPaths(repo, 'initial', ['README.md'])
    runGit(root, ['init', '--bare', remote])
    runGit(repo, ['remote', 'add', 'origin', remote])
    runGit(repo, ['push', '-u', 'origin', 'main'])

    writeFileSync(join(repo, 'README.md'), 'stashed\n')
    runGit(repo, ['stash', 'push', '-m', 'saved work'])
    writeFileSync(join(repo, 'README.md'), 'modified\n')
    writeFileSync(join(repo, 'staged.txt'), 'staged\n')
    runGit(repo, ['add', '--', 'staged.txt'])
    writeFileSync(join(repo, 'untracked.txt'), 'untracked\n')

    const status = await getGitStatus(repo)

    expect(gitStatusResultSchema.parse(status)).toEqual(status)
    expect(status).toMatchObject({
      branch: 'main',
      upstream: 'origin/main',
      ahead: 0,
      behind: 0,
      isDetached: false,
      hasConflicts: false,
      operation: 'none',
      stashCount: 1,
    })
    expect(status.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'README.md', status: 'M', staged: false }),
        expect.objectContaining({ path: 'staged.txt', status: 'A', staged: true }),
        expect.objectContaining({ path: 'untracked.txt', status: '?', staged: false }),
      ])
    )
  })

  it('marks detached HEAD explicitly', async () => {
    const repo = makeWorkspace()
    initRepo(repo)
    writeFileSync(join(repo, 'README.md'), 'initial\n')
    commitPaths(repo, 'initial', ['README.md'])

    runGit(repo, ['checkout', '--detach', 'HEAD'])

    await expect(getGitStatus(repo)).resolves.toMatchObject({
      branch: 'HEAD',
      upstream: null,
      isDetached: true,
      operation: 'none',
    })
  })
})

describe('syncRemote', () => {
  it('pushes the current branch through the main-owned Git host', async () => {
    const root = makeWorkspace()
    const repo = join(root, 'repo')
    const remote = join(root, 'remote.git')
    mkdirSync(repo)

    initRepo(repo)
    writeFileSync(join(repo, 'README.md'), 'initial\n')
    commitPaths(repo, 'initial', ['README.md'])
    runGit(root, ['init', '--bare', remote])
    runGit(repo, ['remote', 'add', 'origin', remote])
    runGit(repo, ['push', '-u', 'origin', 'main'])

    writeFileSync(join(repo, 'README.md'), 'changed\n')
    commitPaths(repo, 'change readme', ['README.md'])

    const result = await syncRemote(repo, 'push')

    expect(gitSyncResultSchema.parse(result)).toEqual(result)
    expect(result).toMatchObject({ ok: true, action: 'push' })
    expect(runGit(root, ['--git-dir', remote, 'log', '--oneline', '-1'])).toContain('change readme')
  })

  it('returns a typed failure when pushing without an upstream', async () => {
    const repo = makeWorkspace()
    initRepo(repo)
    writeFileSync(join(repo, 'README.md'), 'initial\n')
    commitPaths(repo, 'initial', ['README.md'])

    const result = await syncRemote(repo, 'push')

    expect(gitSyncResultSchema.parse(result)).toEqual(result)
    expect(result.ok).toBe(false)
    expect(result.action).toBe('push')
    expect(result.output).not.toHaveLength(0)
  })
})

describe('git refs and branch checkout', () => {
  it('lists local branches, remote branches, and stashes', async () => {
    const root = makeWorkspace()
    const repo = join(root, 'repo')
    const remote = join(root, 'remote.git')
    mkdirSync(repo)

    initRepo(repo)
    writeFileSync(join(repo, 'README.md'), 'initial\n')
    commitPaths(repo, 'initial', ['README.md'])
    runGit(repo, ['checkout', '-b', 'feature/test'])
    writeFileSync(join(repo, 'feature.txt'), 'feature\n')
    commitPaths(repo, 'feature', ['feature.txt'])
    runGit(root, ['init', '--bare', remote])
    runGit(repo, ['remote', 'add', 'origin', remote])
    runGit(repo, ['push', '-u', 'origin', 'feature/test'])

    writeFileSync(join(repo, 'README.md'), 'stashed\n')
    runGit(repo, ['stash', 'push', '-m', 'saved work'])

    const refs = await getGitRefs(repo)

    expect(gitRefsResultSchema.parse(refs)).toEqual(refs)
    expect(refs.branches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'feature/test', current: true, remote: false }),
        expect.objectContaining({ name: 'remotes/origin/feature/test', remote: true }),
      ])
    )
    expect(refs.stashes[0]).toMatchObject({ index: 0 })
    expect(refs.stashes[0]?.message).toContain('saved work')
  })

  it('blocks branch checkout when the worktree is dirty', async () => {
    const repo = makeWorkspace()
    initRepo(repo)
    writeFileSync(join(repo, 'README.md'), 'initial\n')
    commitPaths(repo, 'initial', ['README.md'])
    runGit(repo, ['checkout', '-b', 'feature/test'])
    runGit(repo, ['checkout', 'main'])
    writeFileSync(join(repo, 'README.md'), 'dirty\n')

    const result = await checkoutBranch(repo, 'feature/test')

    expect(gitCheckoutBranchResultSchema.parse(result)).toEqual(result)
    expect(result.ok).toBe(false)
    expect(result.output).toContain('Commit, stash, or discard')
    expect((await getGitStatus(repo)).branch).toBe('main')
  })
})

describe('getGitHistory', () => {
  it('returns recent commits with author, refs, short hashes, graph, and file stats', async () => {
    const repo = makeWorkspace()
    initRepo(repo)
    writeFileSync(join(repo, 'README.md'), 'initial\n')
    commitPaths(repo, 'initial commit', ['README.md'])
    writeFileSync(join(repo, 'feature.txt'), 'feature\n')
    commitPaths(repo, 'add feature workflow', ['feature.txt'])

    const history = await getGitHistory(repo, '', 10)

    expect(gitHistoryResultSchema.parse(history)).toEqual(history)
    expect(history.commits[0]).toMatchObject({
      message: 'add feature workflow',
      authorName: 'OpenPi Test',
      authorEmail: 'openpi@example.com',
    })
    expect(history.commits[0]?.shortHash).toHaveLength(7)
    expect(history.commits[0]?.graph).toBeDefined()
    expect(typeof history.commits[0]?.stats).toBe('string')
  })

  it('filters commits by query in the Git host', async () => {
    const repo = makeWorkspace()
    initRepo(repo)
    writeFileSync(join(repo, 'README.md'), 'initial\n')
    commitPaths(repo, 'initial commit', ['README.md'])
    writeFileSync(join(repo, 'release.txt'), 'release\n')
    commitPaths(repo, 'prepare release notes', ['release.txt'])

    const history = await getGitHistory(repo, 'release', 10)

    expect(history.commits.map((commit) => commit.message)).toEqual(['prepare release notes'])
  })
})

// ─── generateCommitMessage ───────────────────────────────────────────────

describe('generateCommitMessage', () => {
  it('produces feat: for added files', () => {
    const files = [
      {
        path: 'src/components/git/DiffViewer.tsx',
        status: 'A',
        staged: true,
        additions: 120,
        deletions: 0,
      },
    ]
    const msg = generateCommitMessage(files as never)
    expect(msg).toMatch(/^feat/)
    expect(msg).toContain('DiffViewer.tsx')
  })

  it('produces chore: for deleted files', () => {
    const files = [{ path: 'src/old.ts', status: 'D', staged: true, additions: 0, deletions: 50 }]
    const msg = generateCommitMessage(files as never)
    expect(msg).toMatch(/^chore/)
    expect(msg).toContain('remove')
  })

  it('detects git scope from electron/gitHost.ts', () => {
    const files = [
      { path: 'electron/gitHost.ts', status: 'M', staged: true, additions: 10, deletions: 5 },
    ]
    const msg = generateCommitMessage(files as never)
    expect(msg).toContain('(git)')
  })

  it('returns empty string for empty staged list', () => {
    expect(generateCommitMessage([])).toBe('')
  })
})

describe('commitFiles options', () => {
  it('supports signoff commits', async () => {
    const repo = makeWorkspace()
    initRepo(repo)
    writeFileSync(join(repo, 'README.md'), 'initial\n')
    commitPaths(repo, 'initial commit', ['README.md'])
    writeFileSync(join(repo, 'feature.txt'), 'feature\n')

    await commitFiles(repo, ['feature.txt'], 'add feature', false, { signoff: true })

    const body = runGit(repo, ['log', '-1', '--format=%B'])
    expect(body).toContain('add feature')
    expect(body).toContain('Signed-off-by: OpenPi Test <openpi@example.com>')
  })

  it('supports amending the previous commit', async () => {
    const repo = makeWorkspace()
    initRepo(repo)
    writeFileSync(join(repo, 'README.md'), 'initial\n')
    commitPaths(repo, 'initial commit', ['README.md'])
    writeFileSync(join(repo, 'README.md'), 'initial\nupdated\n')

    await commitFiles(repo, ['README.md'], 'amend initial commit', false, { amend: true })

    const count = runGit(repo, ['rev-list', '--count', 'HEAD']).trim()
    const message = runGit(repo, ['log', '-1', '--format=%s']).trim()
    expect(count).toBe('1')
    expect(message).toBe('amend initial commit')
  })
})

describe('conflict status', () => {
  it('marks conflicted files as U and sets hasConflicts', async () => {
    const repo = makeWorkspace()
    initRepo(repo)
    writeFileSync(join(repo, 'README.md'), 'base\n')
    commitPaths(repo, 'base', ['README.md'])

    runGit(repo, ['checkout', '-b', 'feature'])
    writeFileSync(join(repo, 'README.md'), 'feature\n')
    commitPaths(repo, 'feature change', ['README.md'])

    runGit(repo, ['checkout', 'main'])
    writeFileSync(join(repo, 'README.md'), 'main\n')
    commitPaths(repo, 'main change', ['README.md'])

    try {
      runGit(repo, ['merge', 'feature'])
    } catch {
      // expected conflict
    }

    const status = await getGitStatus(repo)

    expect(status.hasConflicts).toBe(true)
    expect(status.operation).toBe('merge')
    expect(status.files).toContainEqual(expect.objectContaining({ path: 'README.md', status: 'U' }))
  })
})
