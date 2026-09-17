import fs from 'node:fs'
/**
 * fileGuards — shared guard predicates for file IPC handlers.
 */
export function isGitMetadataPath(relPath: string): boolean {
  const segments = relPath.split(/[\\/]/)
  return segments.includes('.git')
}

/**
 * Identity proof across a confirmation window. dev+ino alone misses a
 * delete-and-recreate that reuses the freed inode (routine on Linux); size
 * and mtime close that hole with no false positives for untouched files.
 */
export function identityChanged(before: fs.Stats, after: fs.Stats): boolean {
  return (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs
  )
}
