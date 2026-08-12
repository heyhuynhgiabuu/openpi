import fs from 'node:fs'
import path from 'node:path'
import { isPathInside } from '../services/shellEnv'

export interface AuthorizedFileRoot {
  anchor: string
  root: string
}

function assertNoSymlinkComponents(anchor: string, target: string): void {
  const relative = path.relative(anchor, target)
  let current = anchor
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    const stat = fs.lstatSync(current)
    if (stat.isSymbolicLink()) throw new Error('Authorized session root contains a symlink')
  }
}

export function resolveAuthorizedFile(
  submittedPath: string,
  allowedRoots: readonly AuthorizedFileRoot[],
  allowedSuffixes: readonly string[]
): string {
  const filePath = path.resolve(submittedPath)
  if (!allowedSuffixes.some((suffix) => filePath.endsWith(suffix))) {
    throw new Error('Session file has an unsupported suffix')
  }

  const stat = fs.lstatSync(filePath)
  if (!stat.isFile()) throw new Error('Session path is not a regular file')

  for (const allowed of allowedRoots) {
    const anchor = path.resolve(allowed.anchor)
    const root = path.resolve(allowed.root)
    if (!isPathInside(anchor, root) || !isPathInside(root, filePath)) continue
    if (!fs.existsSync(anchor) || !fs.existsSync(root)) continue
    assertNoSymlinkComponents(anchor, root)
    assertNoSymlinkComponents(root, filePath)
    const realRoot = fs.realpathSync(root)
    const realFilePath = fs.realpathSync(filePath)
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
