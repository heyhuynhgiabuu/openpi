import fs from 'node:fs'
import path from 'node:path'
import { isPathInside } from '../services/shellEnv'

export interface AuthorizedFileRoot {
  anchor: string
  root: string
}

export interface ResolveAuthorizedFileOptions {
  /**
   * Accept a path that does not exist on disk yet. The agent creates a session's
   * JSONL lazily, so read-only callers legitimately ask about a file that has not
   * been written. Containment and symlink checks still apply to every component
   * that does exist; the missing tail is purely lexical and cannot redirect.
   */
  allowMissing?: boolean
}

function lstatIfPresent(target: string): fs.Stats | null {
  try {
    return fs.lstatSync(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

function assertNoSymlinkComponents(anchor: string, target: string): void {
  const relative = path.relative(anchor, target)
  let current = anchor
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    const stat = lstatIfPresent(current)
    // Nothing below a missing component exists, so there is nothing left to check.
    if (!stat) return
    if (stat.isSymbolicLink()) throw new Error('Authorized session root contains a symlink')
  }
}

export function resolveAuthorizedFile(
  submittedPath: string,
  allowedRoots: readonly AuthorizedFileRoot[],
  allowedSuffixes: readonly string[],
  options: ResolveAuthorizedFileOptions = {}
): string {
  const filePath = path.resolve(submittedPath)
  if (!allowedSuffixes.some((suffix) => filePath.endsWith(suffix))) {
    throw new Error('Session file has an unsupported suffix')
  }

  const stat = lstatIfPresent(filePath)
  if (!stat && !options.allowMissing) throw new Error('Session file does not exist')
  if (stat && !stat.isFile()) throw new Error('Session path is not a regular file')

  for (const allowed of allowedRoots) {
    const anchor = path.resolve(allowed.anchor)
    const root = path.resolve(allowed.root)
    if (!isPathInside(anchor, root) || !isPathInside(root, filePath)) continue
    if (!fs.existsSync(anchor) || !fs.existsSync(root)) continue
    assertNoSymlinkComponents(anchor, root)
    assertNoSymlinkComponents(root, filePath)
    const realRoot = fs.realpathSync(root)
    // A missing file has no realpath; resolve its lexical tail against the real
    // root instead. Safe because no existing component under root is a symlink.
    const realFilePath = stat
      ? fs.realpathSync(filePath)
      : path.join(realRoot, path.relative(root, filePath))
    if (isPathInside(realRoot, realFilePath)) return filePath
  }
  throw new Error('Session file is outside an authorized sessions directory')
}

export function resolveAuthorizedSessionFile(
  agentDir: string,
  submittedPath: string,
  allowedSuffixes: readonly string[]
): string {
  return resolveAuthorizedFile(
    submittedPath,
    [{ anchor: agentDir, root: path.join(agentDir, 'sessions') }],
    allowedSuffixes
  )
}

export function moveSessionFileNoReplace(source: string, target: string): void {
  fs.linkSync(source, target)
  try {
    fs.unlinkSync(source)
  } catch (error) {
    try {
      fs.unlinkSync(target)
    } catch {
      // Preserve the original unlink failure; rollback is best-effort.
    }
    throw error
  }
}
