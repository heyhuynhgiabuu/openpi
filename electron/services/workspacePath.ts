import fs from 'node:fs'
import path from 'node:path'
import { isPathInside } from './shellEnv'

function lstatIfPresent(filePath: string): fs.Stats | null {
  try {
    return fs.lstatSync(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

function assertNoSymlinkComponents(root: string, target: string, action: string): void {
  const relative = path.relative(root, target)
  let current = root
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    const stat = lstatIfPresent(current)
    if (!stat) return
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing to ${action} through a symlinked path`)
    }
  }
}

export function resolveWorkspacePath(cwd: string, relativePath: string, action: string): string {
  const workspaceRoot = path.resolve(cwd)
  const lexicalTarget = path.resolve(workspaceRoot, relativePath)
  if (lexicalTarget === workspaceRoot || !isPathInside(workspaceRoot, lexicalTarget)) {
    throw new Error(`Refusing to ${action} outside workspace`)
  }

  const realWorkspaceRoot = fs.realpathSync(workspaceRoot)
  assertNoSymlinkComponents(workspaceRoot, lexicalTarget, action)
  const targetStat = lstatIfPresent(lexicalTarget)
  if (targetStat) {
    const realTarget = fs.realpathSync(lexicalTarget)
    if (!isPathInside(realWorkspaceRoot, realTarget)) {
      throw new Error(`Refusing to ${action} outside workspace`)
    }
    return lexicalTarget
  }

  let existingParent = path.dirname(lexicalTarget)
  while (!lstatIfPresent(existingParent)) {
    const next = path.dirname(existingParent)
    if (next === existingParent) {
      throw new Error(`Refusing to ${action} outside workspace`)
    }
    existingParent = next
  }
  const realParent = fs.realpathSync(existingParent)
  if (!isPathInside(realWorkspaceRoot, realParent)) {
    throw new Error(`Refusing to ${action} outside workspace`)
  }
  const realTarget = path.resolve(realParent, path.relative(existingParent, lexicalTarget))
  if (!isPathInside(realWorkspaceRoot, realTarget)) {
    throw new Error(`Refusing to ${action} outside workspace`)
  }
  return lexicalTarget
}

function assertOpenedWorkspaceFile(
  descriptor: number,
  workspaceRoot: string,
  filePath: string
): void {
  const openedStat = fs.fstatSync(descriptor)
  const currentStat = fs.lstatSync(filePath)
  if (
    !openedStat.isFile() ||
    !currentStat.isFile() ||
    openedStat.dev !== currentStat.dev ||
    openedStat.ino !== currentStat.ino
  ) {
    throw new Error('Workspace file changed during authorization')
  }
  assertNoSymlinkComponents(path.resolve(workspaceRoot), path.resolve(filePath), 'access')
  const realWorkspaceRoot = fs.realpathSync(workspaceRoot)
  const realFilePath = fs.realpathSync(filePath)
  if (!isPathInside(realWorkspaceRoot, realFilePath)) {
    throw new Error('Workspace file escaped its authorized root')
  }
}

export function readWorkspaceBytes(filePath: string, workspaceRoot: string): Buffer {
  const descriptor = fs.openSync(
    filePath,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK
  )
  try {
    assertOpenedWorkspaceFile(descriptor, workspaceRoot, filePath)
    return fs.readFileSync(descriptor)
  } finally {
    fs.closeSync(descriptor)
  }
}

export function readWorkspaceFile(filePath: string, workspaceRoot: string): string {
  return readWorkspaceBytes(filePath, workspaceRoot).toString('utf-8')
}

export function writeWorkspaceBytes(
  filePath: string,
  content: Uint8Array,
  workspaceRoot: string,
  options: { exclusive?: boolean } = {}
): void {
  const exclusiveFlag = options.exclusive ? fs.constants.O_EXCL : 0
  const flags =
    fs.constants.O_WRONLY |
    fs.constants.O_CREAT |
    exclusiveFlag |
    fs.constants.O_NOFOLLOW |
    fs.constants.O_NONBLOCK
  const descriptor = fs.openSync(filePath, flags, 0o666)
  try {
    assertOpenedWorkspaceFile(descriptor, workspaceRoot, filePath)
    fs.ftruncateSync(descriptor, 0)
    fs.writeFileSync(descriptor, content)
  } finally {
    fs.closeSync(descriptor)
  }
}

export function writeWorkspaceFile(
  filePath: string,
  content: string,
  workspaceRoot: string,
  options: { exclusive?: boolean } = {}
): void {
  writeWorkspaceBytes(filePath, Buffer.from(content, 'utf-8'), workspaceRoot, options)
}

export function moveWorkspaceEntryNoReplace(source: string, target: string): void {
  const sourceStat = fs.lstatSync(source)
  if (sourceStat.isFile()) {
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
    return
  }
  if (lstatIfPresent(target)) throw new Error('Target already exists')
  fs.renameSync(source, target)
}
