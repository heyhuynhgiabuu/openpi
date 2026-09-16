/**
 * fileGuards — shared guard predicates for file IPC handlers.
 */
export function isGitMetadataPath(relPath: string): boolean {
  const segments = relPath.split(/[\\/]/)
  return segments.includes('.git')
}
