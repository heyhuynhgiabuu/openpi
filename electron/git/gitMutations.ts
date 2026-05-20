/**
 * gitMutations.ts — All git mutation operations for OpenPi.
 *
 * Extracted from gitHost.ts. Every function creates its own simple-git instance;
 * there is no shared module state.
 *
 * NEVER uses `git add .` or `git add -A`; always passes explicit file paths.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import simpleGit from 'simple-git'
import type { GitSyncAction, GitSyncResult } from '../../src/lib/ipc'

// ─── Stage / unstage ──────────────────────────────────────────────────────

export async function stageFile(cwd: string, filePath: string): Promise<void> {
  const git = simpleGit({ baseDir: cwd })
  const existsOnDisk = fs.existsSync(path.join(cwd, filePath))

  if (!existsOnDisk) {
    // File was deleted from the working tree.
    // Stage the deletion by removing it from the index.
    try {
      await git.rm(['--cached', '--', filePath])
    } catch {
      // Not in the index either (ghost entry) — nothing to stage.
    }
    return
  }

  // File exists on disk — normal staging.
  // Retry with --force for files inside gitignored directories.
  try {
    await git.add([filePath])
  } catch (err) {
    if (String(err).includes('ignored by one of your .gitignore files')) {
      await git.add(['--force', filePath])
      return
    }
    throw err
  }
}

export async function unstageFile(cwd: string, filePath: string): Promise<void> {
  await simpleGit({ baseDir: cwd }).reset(['HEAD', '--', filePath])
}

// ─── Commit ───────────────────────────────────────────────────────────────

export async function commitFiles(
  cwd: string,
  paths: string[],
  message: string,
  push = false,
  options: { amend?: boolean; signoff?: boolean } = {}
): Promise<void> {
  const git = simpleGit({ baseDir: cwd })
  // Stage each file explicitly — never use `git add .`
  for (const p of paths) {
    const existsOnDisk = fs.existsSync(path.join(cwd, p))
    if (!existsOnDisk) {
      try {
        await git.rm(['--cached', '--', p])
      } catch {
        /* ghost — not in index, skip */
      }
      continue
    }
    try {
      await git.add([p])
    } catch (err) {
      if (String(err).includes('ignored by one of your .gitignore files')) {
        await git.add(['--force', p])
      } else {
        throw err
      }
    }
  }
  const commitArgs = ['commit', '-m', message]
  if (options.amend) commitArgs.push('--amend')
  if (options.signoff) commitArgs.push('--signoff')
  await git.raw(commitArgs)
  if (push) {
    await git.push()
  }
}

// ─── Discard ──────────────────────────────────────────────────────────────

export async function discardFile(cwd: string, filePath: string): Promise<void> {
  await simpleGit({ baseDir: cwd }).checkout(['--', filePath])
}

// ─── Remote sync ──────────────────────────────────────────────────────────

export async function syncRemote(cwd: string, action: GitSyncAction): Promise<GitSyncResult> {
  const git = simpleGit({ baseDir: cwd })
  try {
    let output = ''
    if (action === 'fetch') {
      output = await git.fetch().then(() => 'Fetched remote refs.')
    } else if (action === 'pull') {
      output = await git.pull().then(() => 'Pulled current branch.')
    } else if (action === 'pull-rebase') {
      output = await git.pull(['--rebase']).then(() => 'Pulled current branch with rebase.')
    } else {
      output = await git.push().then(() => 'Pushed current branch.')
    }
    return { ok: true, action, output: output.trim() || `${action} completed.` }
  } catch (error) {
    return { ok: false, action, output: error instanceof Error ? error.message : String(error) }
  }
}

// ─── Create branch ─────────────────────────────────────────────────────────

export async function createBranch(
  cwd: string,
  name: string
): Promise<{ ok: boolean; name: string; output: string }> {
  const git = simpleGit({ baseDir: cwd })
  try {
    // Check if branch already exists
    const existing = await git.branch(['--list', name])
    if (existing.all.length > 0) {
      return { ok: false, name, output: `Branch "${name}" already exists.` }
    }

    const output = await git.raw(['branch', name])
    return { ok: true, name, output: output.trim() || `Created branch "${name}".` }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return { ok: false, name, output: msg }
  }
}

// ─── Stash operations ────────────────────────────────────────────────────────

export async function stashApply(
  cwd: string,
  index: number
): Promise<{ ok: boolean; output: string }> {
  const git = simpleGit({ baseDir: cwd })
  try {
    const output = await git.raw(['stash', 'apply', `stash@{${index}}`])
    return { ok: true, output: output.trim() || `Applied stash@{${index}}.` }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return { ok: false, output: msg }
  }
}

export async function stashPop(
  cwd: string,
  index: number
): Promise<{ ok: boolean; output: string }> {
  const git = simpleGit({ baseDir: cwd })
  try {
    const output = await git.raw(['stash', 'pop', `stash@{${index}}`])
    return { ok: true, output: output.trim() || `Popped stash@{${index}}.` }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return { ok: false, output: msg }
  }
}

export async function stashDrop(
  cwd: string,
  index: number
): Promise<{ ok: boolean; output: string }> {
  const git = simpleGit({ baseDir: cwd })
  try {
    const output = await git.raw(['stash', 'drop', `stash@{${index}}`])
    return { ok: true, output: output.trim() || `Dropped stash@{${index}}.` }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return { ok: false, output: msg }
  }
}
