import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getGitFileDiff, getGitStatus } from '../electron/git/gitDiffStatus'
import { createTestRepo, type TestRepo } from './helpers/gitRepo'

const FILE = 'src/app.ts'
const THREE_LINES = ['line 1', 'original line 2', 'line 3', ''].join('\n')

describe('getGitStatus (integration)', () => {
  let repo: TestRepo

  beforeEach(async () => {
    repo = await createTestRepo({ [FILE]: THREE_LINES })
  })

  afterEach(() => {
    repo?.cleanup()
  })

  const statusFor = async (filePath: string) => {
    const status = await getGitStatus(repo.cwd)
    return status.files.find((f) => f.path === filePath)
  }

  it('reports a clean repository with no changed files', async () => {
    const status = await getGitStatus(repo.cwd)

    expect(status.files).toEqual([])
    expect(status.branch).toBe('main')
    expect(status.operation).toBe('none')
    expect(status.hasConflicts).toBe(false)
    expect(status.stashCount).toBe(0)
    expect(status.totalAdded).toBe(0)
    expect(status.totalRemoved).toBe(0)
    expect(status.isDetached).toBe(false)
  })

  it('reports an untracked file with no line counts', async () => {
    repo.write('src/new.ts', 'one\ntwo\n')

    const file = await statusFor('src/new.ts')

    expect(file?.status).toBe('?')
    expect(file?.staged).toBe(false)
    // `git diff --numstat` does not cover untracked files, so the panel shows 0/0.
    expect(file?.added).toBe(0)
    expect(file?.removed).toBe(0)
  })

  it('counts an unstaged modification from the working tree diff', async () => {
    repo.write(FILE, ['line 1', 'CHANGED', 'line 3', ''].join('\n'))

    const file = await statusFor(FILE)

    expect(file?.status).toBe('M')
    expect(file?.staged).toBe(false)
    expect(file?.added).toBe(1)
    expect(file?.removed).toBe(1)
  })

  it('counts a staged modification and marks it staged', async () => {
    repo.write(FILE, ['line 1', 'STAGED', 'line 3', ''].join('\n'))
    await repo.stage()

    const file = await statusFor(FILE)

    expect(file?.status).toBe('M')
    expect(file?.staged).toBe(true)
    expect(file?.added).toBe(1)
    expect(file?.removed).toBe(1)
  })

  it('counts only the staged side when a file is staged and modified again', async () => {
    repo.write(FILE, ['line 1', 'STAGED', 'line 3', ''].join('\n'))
    await repo.stage()
    repo.write(FILE, ['line 1', 'STAGED', 'line 3', 'UNSTAGED', ''].join('\n'))

    const file = await statusFor(FILE)

    expect(file?.status).toBe('M')
    expect(file?.staged).toBe(true)
    // The staged map wins, so the working-tree delta is not added on top.
    expect(file?.added).toBe(1)
    expect(file?.removed).toBe(1)
  })

  it('reports a staged addition with its line count', async () => {
    repo.write('src/added.ts', 'one\ntwo\nthree\n')
    await repo.stage()

    const file = await statusFor('src/added.ts')

    expect(file?.status).toBe('A')
    expect(file?.staged).toBe(true)
    expect(file?.added).toBe(3)
    expect(file?.removed).toBe(0)
  })

  it('reports a deletion', async () => {
    fs.rmSync(path.join(repo.cwd, FILE))
    await repo.stage()

    const file = await statusFor(FILE)

    expect(file?.status).toBe('D')
    expect(file?.staged).toBe(true)
    expect(file?.removed).toBe(3)
  })

  it('totals the per-file counts', async () => {
    repo.write(FILE, ['line 1', 'CHANGED', 'line 3', ''].join('\n'))
    repo.write('src/other.ts', 'one\ntwo\nthree\n')
    await repo.stage()

    const status = await getGitStatus(repo.cwd)

    expect(status.totalAdded).toBe(4)
    expect(status.totalRemoved).toBe(1)
  })

  it('counts a stash', async () => {
    repo.write(FILE, ['line 1', 'STASHED', 'line 3', ''].join('\n'))
    await repo.git.stash(['push'])

    const status = await getGitStatus(repo.cwd)

    expect(status.stashCount).toBe(1)
    expect(status.files).toEqual([])
  })

  it('reports a detached head', async () => {
    const hash = (await repo.git.revparse(['HEAD'])).trim()
    await repo.git.checkout(hash)

    const status = await getGitStatus(repo.cwd)

    expect(status.isDetached).toBe(true)
    expect(status.branch).toBe('HEAD')
  })

  it('reports a conflicted merge, its operation and the conflict flag', async () => {
    await repo.git.checkoutLocalBranch('other')
    repo.write(FILE, ['line 1', 'OTHER', 'line 3', ''].join('\n'))
    await repo.stage()
    await repo.commit('other change')

    await repo.git.checkout('main')
    repo.write(FILE, ['line 1', 'MAIN', 'line 3', ''].join('\n'))
    await repo.stage()
    await repo.commit('main change')

    await repo.git.merge(['other']).catch(() => undefined)

    const status = await getGitStatus(repo.cwd)
    const file = status.files.find((f) => f.path === FILE)

    expect(file?.status).toBe('U')
    expect(status.hasConflicts).toBe(true)
    expect(status.operation).toBe('merge')
  })
})

describe('getGitFileDiff for untracked and deleted files (integration)', () => {
  let repo: TestRepo

  beforeEach(async () => {
    repo = await createTestRepo({ [FILE]: THREE_LINES })
  })

  afterEach(() => {
    repo?.cleanup()
  })

  it('returns the whole file as an addition for an untracked file', async () => {
    repo.write('src/new.ts', 'one\ntwo\n')

    for (const scope of ['unstaged', 'auto'] as const) {
      const diff = await getGitFileDiff(repo.cwd, 'src/new.ts', { scope })

      expect(diff.rawPatch).toBe('')
      expect(diff.oldContent).toBe('')
      expect(diff.newContent).toBe('one\ntwo\n')
      expect(diff.totalAdded).toBe(2)
      expect(diff.totalRemoved).toBe(0)
      expect(diff.isNew).toBe(true)
      expect(diff.isDeleted).toBe(false)
    }
  })

  it('counts an untracked empty file as new with no lines', async () => {
    repo.write('src/empty.ts', '')

    const diff = await getGitFileDiff(repo.cwd, 'src/empty.ts', { scope: 'unstaged' })

    expect(diff.isNew).toBe(true)
    expect(diff.totalAdded).toBe(0)
  })

  it('returns an empty diff for a path that does not exist', async () => {
    const diff = await getGitFileDiff(repo.cwd, 'src/missing.ts', { scope: 'unstaged' })

    expect(diff.rawPatch).toBe('')
    expect(diff.isNew).toBe(false)
    expect(diff.isDeleted).toBe(false)
    expect(diff.totalAdded).toBe(0)
  })

  it('reports an unstaged deletion with its removed lines', async () => {
    fs.rmSync(path.join(repo.cwd, FILE))

    const diff = await getGitFileDiff(repo.cwd, FILE, { scope: 'unstaged' })

    expect(diff.rawPatch).toContain('-original line 2')
    expect(diff.totalRemoved).toBe(3)
    expect(diff.totalAdded).toBe(0)
    expect(diff.isDeleted).toBe(true)
    expect(diff.newContent).toBe('')
  })

  it('counts a removed markdown rule through the real patch', async () => {
    repo.write('README.md', 'title\n\n---\n\nafter\n')
    await repo.stage()
    await repo.commit('add readme')
    repo.write('README.md', 'title\n\nafter\n')

    const diff = await getGitFileDiff(repo.cwd, 'README.md', { scope: 'unstaged' })

    expect(diff.rawPatch).toContain('----')
    expect(diff.totalRemoved).toBe(2)
  })

  it('returns no counts for a binary change', async () => {
    const binary = Buffer.from([0, 1, 2, 3, 255, 254])
    fs.writeFileSync(path.join(repo.cwd, 'blob.bin'), binary)
    await repo.stage()
    await repo.commit('add binary')
    fs.writeFileSync(path.join(repo.cwd, 'blob.bin'), Buffer.from([0, 9, 9, 255, 254]))

    const diff = await getGitFileDiff(repo.cwd, 'blob.bin', { scope: 'unstaged' })

    expect(diff.rawPatch).toContain('Binary files')
    expect(diff.totalAdded).toBe(0)
    expect(diff.totalRemoved).toBe(0)
  })
})
