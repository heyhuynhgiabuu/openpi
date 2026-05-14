import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  checkoutBranch,
  getFileTree,
  getGitRefs,
  getGitStatus,
  syncRemote,
} from '../electron/gitHost'
import {
  gitCheckoutBranchResultSchema,
  gitRefsResultSchema,
  gitStatusResultSchema,
  gitSyncResultSchema,
} from '../src/lib/ipc'

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
