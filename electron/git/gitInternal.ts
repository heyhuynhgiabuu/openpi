/**
 * Shared internal helpers for the git read models: porcelain status-code
 * resolution, git-dir detection, and content readers. The pure ones are
 * exported so status codes, line counting, and ref resolution can be tested
 * without a repository.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import simpleGit from 'simple-git'
import type { GitChangedFile, GitFileDiff, GitOperation } from '../../src/lib/ipc'

export function effectiveStatus(index: string, workingDir: string): GitChangedFile['status'] {
  if (index === 'U' || workingDir === 'U') return 'U'
  // Prefer staged status; fall back to working-dir status.
  const s = index !== ' ' && index !== '?' && index !== '' ? index : workingDir
  if (s === 'A') return 'A'
  if (s === 'D') return 'D'
  if (s === 'R') return 'R'
  if (s === '?') return '?'
  return 'M'
}

export async function readGitText(
  git: ReturnType<typeof simpleGit>,
  spec: string
): Promise<string | null> {
  try {
    return await git.raw(['show', spec])
  } catch {
    return null
  }
}

export function readWorkingText(cwd: string, filePath: string): string | null {
  try {
    const fullPath = path.join(cwd, filePath)
    if (!fs.statSync(fullPath).isFile()) return null
    return fs.readFileSync(fullPath, 'utf8')
  } catch {
    return null
  }
}

export async function readDiffContents(
  cwd: string,
  git: ReturnType<typeof simpleGit>,
  filePath: string,
  source: 'working' | 'index' | 'branch',
  baseRef?: string
): Promise<Pick<GitFileDiff, 'oldContent' | 'newContent'>> {
  const oldRef = source === 'branch' && baseRef ? `${baseRef}:${filePath}` : `HEAD:${filePath}`
  const oldContent = (await readGitText(git, oldRef)) ?? ''
  const newContent =
    source === 'index'
      ? ((await readGitText(git, `:${filePath}`)) ?? '')
      : (readWorkingText(cwd, filePath) ?? '')
  return { oldContent, newContent }
}

export function resolveGitDir(cwd: string, gitDir: string): string {
  if (gitDir.startsWith('/')) return gitDir
  return path.resolve(cwd, gitDir)
}

function gitFileExists(gitDir: string, name: string): boolean {
  return fs.existsSync(path.join(gitDir, name))
}

function gitDirExists(gitDir: string, name: string): boolean {
  try {
    return fs.statSync(path.join(gitDir, name)).isDirectory()
  } catch {
    return false
  }
}

export async function detectGitOperation(cwd: string): Promise<GitOperation> {
  const git = simpleGit({ baseDir: cwd })
  const rawGitDir = await git.raw(['rev-parse', '--git-dir']).catch(() => '')
  const gitDir = resolveGitDir(cwd, rawGitDir.trim())
  if (gitFileExists(gitDir, 'MERGE_HEAD')) return 'merge'
  if (gitDirExists(gitDir, 'rebase-merge') || gitDirExists(gitDir, 'rebase-apply')) return 'rebase'
  if (gitFileExists(gitDir, 'CHERRY_PICK_HEAD')) return 'cherry-pick'
  return 'none'
}
