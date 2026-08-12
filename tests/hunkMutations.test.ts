import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import simpleGit from 'simple-git'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stageHunk, unstageHunk } from '../electron/git/gitMutations'
import { registerGitIpc } from '../electron/git/ipc'
import { IPC } from '../src/lib/ipc'

/**
 * Integration tests for hunk-level git operations. These spin up a real
 * temp git repo, write a file, modify it, and verify that stageHunk /
 * unstageHunk correctly apply a single hunk via `git apply`.
 */
describe('hunk mutations (integration)', () => {
  let tmpDir: string
  let cwd: string

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-hunk-test-'))
    cwd = tmpDir

    // Initialize a real git repo with a committed file
    const git = simpleGit({ baseDir: cwd })
    await git.init()
    await git.addConfig('user.email', 'test@example.com')
    await git.addConfig('user.name', 'Test User')
    // Some environments need a default branch name
    try {
      await git.branch(['-M', 'main'])
    } catch {
      /* not all git versions support this */
    }

    const filePath = path.join(cwd, 'src', 'foo.ts')
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(
      filePath,
      ['export function add(a: number, b: number): number {', '  return a + b', '}', ''].join('\n'),
      'utf-8'
    )
    await git.add('src/foo.ts')
    await git.commit('initial')
  })

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  function makeHunkPatch(relativePath: string, oldLine: string, newLine: string): string {
    // Build a minimal patch with the file header + a single hunk.
    // The file has 3 lines + trailing newline. We replace the middle line.
    return [
      `diff --git a/${relativePath} b/${relativePath}`,
      `--- a/${relativePath}`,
      `+++ b/${relativePath}`,
      `@@ -1,3 +1,3 @@`,
      ` export function add(a: number, b: number): number {`,
      `-${oldLine}`,
      `+${newLine}`,
      ` }`,
      ``, // trailing newline (empty line)
    ].join('\n')
  }

  it('stages a single hunk via `git apply --cached`', async () => {
    const filePath = path.join(cwd, 'src', 'foo.ts')
    // Mutate the file
    fs.writeFileSync(
      filePath,
      [
        'export function add(a: number, b: number): number {',
        '  return a + b + 1', // <-- modified line
        '}',
        '',
      ].join('\n'),
      'utf-8'
    )

    const patch = makeHunkPatch('src/foo.ts', '  return a + b', '  return a + b + 1')

    const result = await stageHunk(cwd, 'src/foo.ts', patch)
    expect(result.ok).toBe(true)
    expect(result.filePath).toBe('src/foo.ts')

    // Verify the file is now staged
    const git = simpleGit({ baseDir: cwd })
    const status = await git.status()
    expect(status.staged).toContain('src/foo.ts')
  })

  it('unstages a single hunk via `git apply --cached --reverse`', async () => {
    const filePath = path.join(cwd, 'src', 'foo.ts')
    // First stage the change
    fs.writeFileSync(
      filePath,
      ['export function add(a: number, b: number): number {', '  return a + b + 1', '}', ''].join(
        '\n'
      ),
      'utf-8'
    )
    const git = simpleGit({ baseDir: cwd })
    await git.add('src/foo.ts')
    let status = await git.status()
    expect(status.staged).toContain('src/foo.ts')

    // Now unstage just the hunk
    const patch = makeHunkPatch('src/foo.ts', '  return a + b', '  return a + b + 1')
    const result = await unstageHunk(cwd, 'src/foo.ts', patch)
    expect(result.ok).toBe(true)

    // Verify the file is now unstaged
    status = await git.status()
    expect(status.staged).not.toContain('src/foo.ts')
    // But the working-tree change should still be there
    expect(status.modified).toContain('src/foo.ts')
  })

  it('returns ok=false when the patch does not apply', async () => {
    // Build a patch with a context line that doesn't match the file
    // contents, so git apply will reject it.
    const patch = [
      'diff --git a/src/foo.ts b/src/foo.ts',
      '--- a/src/foo.ts',
      '+++ b/src/foo.ts',
      '@@ -1,3 +1,3 @@',
      ' export function totally_different_context_line() {}',
      '-  return a + b',
      '+  return a + b + 99',
      ' }',
      '',
    ].join('\n')
    const result = await stageHunk(cwd, 'src/foo.ts', patch)
    expect(result.ok).toBe(false)
    expect(result.output).toMatch(/patch|apply/i)
  })
})

describe('Git hunk IPC path authorization', () => {
  type IpcHandler = (event: unknown, raw?: unknown) => unknown

  function createStageHunkHandler() {
    const handlers = new Map<string, IpcHandler>()
    const stageHunkMock = vi.fn().mockResolvedValue({ ok: true })
    const deps: Parameters<typeof registerGitIpc>[0] = {
      ipcMain: {
        handle: vi.fn((channel: string, handler: IpcHandler) => handlers.set(channel, handler)),
        on: vi.fn(),
      } as unknown as Parameters<typeof registerGitIpc>[0]['ipcMain'],
      getCwd: () => '/workspace',
      getDeferredWorkspace: () => null,
      getGitHost: async () =>
        ({
          stageHunk: stageHunkMock,
        }) as unknown as Awaited<ReturnType<Parameters<typeof registerGitIpc>[0]['getGitHost']>>,
      restartGitMonitoring: vi.fn(),
      filterBlockedPaths: vi.fn(() => ({ allowed: [], blocked: [] })),
      confirmHighRiskMutation: vi.fn(),
      getCommitAgentContext: vi.fn(),
    }
    registerGitIpc(deps)
    const handler = handlers.get(IPC.GIT_STAGE_HUNK)
    if (!handler) throw new Error('Expected GIT_STAGE_HUNK handler')
    return { handler, stageHunkMock }
  }

  it('rejects traversal in the requested file path before Git receives it', async () => {
    const { handler, stageHunkMock } = createStageHunkHandler()
    const patch = [
      'diff --git a/../outside.ts b/../outside.ts',
      '--- a/../outside.ts',
      '+++ b/../outside.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      '',
    ].join('\n')

    await expect(handler({}, { path: '../outside.ts', hunkPatch: patch })).rejects.toThrow(
      /unsafe file path/i
    )
    expect(stageHunkMock).not.toHaveBeenCalled()
  })

  it('rejects a rename source that only matches the requested basename', async () => {
    const { handler, stageHunkMock } = createStageHunkHandler()
    const patch = [
      'diff --git a/src/foo.ts b/src/foo.ts',
      'similarity index 90%',
      'rename from other/foo.ts',
      'rename to src/foo.ts',
      '--- a/src/foo.ts',
      '+++ b/src/foo.ts',
      '',
    ].join('\n')

    await expect(handler({}, { path: 'src/foo.ts', hunkPatch: patch })).rejects.toThrow(
      /rename source/i
    )
    expect(stageHunkMock).not.toHaveBeenCalled()
  })

  it('rejects an unrecognized old-file prefix before Git receives a reversible patch', async () => {
    const { handler, stageHunkMock } = createStageHunkHandler()
    const patch = [
      'diff --git a/src/foo.ts b/src/foo.ts',
      '--- x/src/secret.ts',
      '+++ b/src/foo.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      '',
    ].join('\n')

    await expect(handler({}, { path: 'src/foo.ts', hunkPatch: patch })).rejects.toThrow(
      /source path|malformed hunk patch/i
    )
    expect(stageHunkMock).not.toHaveBeenCalled()
  })

  it('rejects a patch containing a second file before Git receives it', async () => {
    const { handler, stageHunkMock } = createStageHunkHandler()
    const patch = [
      'diff --git a/src/foo.ts b/src/foo.ts',
      '--- a/src/foo.ts',
      '+++ b/src/foo.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      'diff --git a/src/secret.ts b/src/secret.ts',
      '--- a/src/secret.ts',
      '+++ b/src/secret.ts',
      '@@ -1 +1 @@',
      '-safe',
      '+compromised',
      '',
    ].join('\n')

    await expect(handler({}, { path: 'src/foo.ts', hunkPatch: patch })).rejects.toThrow(
      /exactly one file/i
    )
    expect(stageHunkMock).not.toHaveBeenCalled()
  })
})
