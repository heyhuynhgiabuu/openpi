/**
 * extensionFiles.ts — Which files in a directory Pi treats as extension entries.
 *
 * Extracted from customizationHelpers.ts. The rules mirror Pi's own loader, so a
 * file Pi loads but this module skips is a customization the panel never shows.
 */

import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

/**
 * Entry extensions Pi's loader accepts (`isExtensionFile` in the SDK): `.ts` and
 * `.js`. Missing `.js` here meant an extension Pi loaded stayed invisible in the
 * Customizations panel.
 */
const EXTENSION_ENTRY_EXTENSIONS = new Set(['.ts', '.js'])

export function isExtensionEntryFile(filePath: string): boolean {
  return EXTENSION_ENTRY_EXTENSIONS.has(path.extname(filePath))
}

interface DirEntryLike {
  name: string
  isFile(): boolean
  isDirectory(): boolean
  isSymbolicLink(): boolean
}

interface ResolvedEntry {
  name: string
  isFile: boolean
  isDirectory: boolean
}

/** Pi follows a symlinked entry; a dangling link contributes nothing. */
function describeEntry(dir: string, entry: DirEntryLike): ResolvedEntry {
  if (!entry.isSymbolicLink()) {
    return { name: entry.name, isFile: entry.isFile(), isDirectory: entry.isDirectory() }
  }
  try {
    const stats = statSync(path.join(dir, entry.name))
    return { name: entry.name, isFile: stats.isFile(), isDirectory: stats.isDirectory() }
  } catch {
    return { name: entry.name, isFile: false, isDirectory: false }
  }
}

/**
 * The entry files a directory contributes, sorted for a stable listing: every
 * visible `*.ts`/`*.js` file, plus `index.ts` or `index.js` inside a
 * subdirectory. Takes the listing as data so the ordering is testable.
 */
export function selectExtensionEntries(entries: readonly ResolvedEntry[], dir: string): string[] {
  const files: string[] = []

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const entryPath = path.join(dir, entry.name)
    if (entry.isFile && isExtensionEntryFile(entryPath)) {
      files.push(entryPath)
      continue
    }
    if (entry.isDirectory) {
      // Pi resolves a directory's entry points as index.ts then index.js.
      for (const indexName of ['index.ts', 'index.js']) {
        const indexPath = path.join(entryPath, indexName)
        if (existsSync(indexPath) && statSync(indexPath).isFile()) {
          files.push(indexPath)
          break
        }
      }
    }
  }

  return files.sort((a, b) => a.localeCompare(b))
}

export function collectExtensionFiles(targetPath: string): string[] {
  const resolvedPath = path.resolve(targetPath)
  let stats: ReturnType<typeof statSync>
  try {
    stats = statSync(resolvedPath)
  } catch {
    // A broken symlink or a path removed mid-scan must not break the inventory.
    return []
  }
  if (stats.isFile()) {
    if (isExtensionEntryFile(resolvedPath)) return [resolvedPath]
    return []
  }
  if (!stats.isDirectory()) return []

  let entries: ResolvedEntry[]
  try {
    entries = readdirSync(resolvedPath, { withFileTypes: true }).map((entry) =>
      describeEntry(resolvedPath, entry)
    )
  } catch {
    return []
  }

  return selectExtensionEntries(entries, resolvedPath)
}
