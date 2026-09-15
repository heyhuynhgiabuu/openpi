import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getGitFileDiff } from '../electron/git/gitDiffStatus'
import { createTestRepo, type TestRepo } from './helpers/gitRepo'

/** One conflict setup: what each side committed, and an optional hand-resolved worktree. */
interface ConflictCase {
  name: string
  base: string
  ours: string
  theirs: string
  worktree?: string
}

const FILE = 'src/app.ts'
const THREE_LINES = ['line 1', 'original line 2', 'line 3', ''].join('\n')

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

  it('counts a removed line whose content is the header prefix', async () => {
    repo.write('notes.txt', 'title\n-- \nafter\n')
    await repo.stage()
    await repo.commit('add notes')
    repo.write('notes.txt', 'title\nafter\n')

    const diff = await getGitFileDiff(repo.cwd, 'notes.txt', { scope: 'unstaged' })

    // The removed line is `-- `, so its patch line is `--- `.
    expect(diff.rawPatch).toContain('\n--- \n')
    expect(diff.totalRemoved).toBe(1)
    expect(diff.totalAdded).toBe(0)
  })

  it('matches git own line counts for each conflict case', async () => {
    const conflicts: ConflictCase[] = [
      {
        name: 'symmetric',
        base: ['line 1', 'original', 'line 3', ''].join('\n'),
        ours: ['line 1', 'MAIN', 'line 3', ''].join('\n'),
        theirs: ['line 1', 'OTHER', 'line 3', ''].join('\n'),
      },
      {
        name: 'ours adds several lines',
        base: ['line 1', 'original', 'line 3', ''].join('\n'),
        ours: ['line 1', 'MAIN', 'added a', 'added b', 'added c', 'line 3', ''].join('\n'),
        theirs: ['line 1', 'OTHER', 'line 3', ''].join('\n'),
      },
      {
        name: 'theirs deletes the line we changed',
        base: ['line 1', 'original', 'line 3', ''].join('\n'),
        ours: ['line 1', 'MAIN', 'line 3', ''].join('\n'),
        theirs: ['line 1', 'line 3', ''].join('\n'),
      },
      {
        // The conflict markers stay, but the theirs-only line is gone, which is
        // the only shape that puts a `-` in the second column. Counting the last
        // column would report 5/2 where git reports 3/0.
        name: 'theirs-only line dropped from the worktree',
        base: ['l1', 'l2', 'l3', 'l4', ''].join('\n'),
        ours: ['l1', 'O2', 'l3', 'l4', ''].join('\n'),
        theirs: ['l1', 'T2', 'l3', 'l4', ''].join('\n'),
        worktree: 'l1\n<<<<<<< HEAD\nO2\n=======\n>>>>>>> other\nl3\nl4\n',
      },
    ]

    for (const conflict of conflicts) {
      const repo = await createTestRepo({ [FILE]: conflict.base })
      try {
        await repo.git.checkoutLocalBranch('other')
        repo.write(FILE, conflict.theirs)
        await repo.stage()
        await repo.commit('theirs')

        await repo.git.checkout('main')
        repo.write(FILE, conflict.ours)
        await repo.stage()
        await repo.commit('ours')

        await repo.git.merge(['other']).catch(() => undefined)
        if (conflict.worktree) repo.write(FILE, conflict.worktree)

        const diff = await getGitFileDiff(repo.cwd, FILE, { scope: 'unstaged' })
        // Git's own count for the same path is the oracle: the combined diff's
        // first column is stage 2, which is what `git diff HEAD` compares.
        const numstat = await repo.git.raw(['diff', 'HEAD', '--numstat', '--', FILE])
        const [added, removed] = numstat.trim().split(/\s+/)

        expect(diff.rawPatch).toContain('@@@')
        expect({
          conflict: conflict.name,
          added: diff.totalAdded,
          removed: diff.totalRemoved,
        }).toEqual({
          conflict: conflict.name,
          added: Number(added),
          removed: Number(removed),
        })
      } finally {
        repo.cleanup()
      }
    }
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
