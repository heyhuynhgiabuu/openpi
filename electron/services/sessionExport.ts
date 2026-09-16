/**
 * sessionExport.ts — Branch-aware session export bundle.
 *
 * Copies the REAL Pi session JSONL byte-for-byte (so the exported tree keeps
 * every parentId, compaction, and branch — Pi's own format stays the source of
 * truth), adds any pi-task sub-sessions referenced by task results in the
 * conversation, and writes a checksummed manifest. Everything is computed in
 * Electron main; the renderer only triggers the export.
 *
 * The bundle intentionally contains raw prompts and tool output: it may
 * contain secrets, and every bundle says so in its manifest and README.
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { resolveAuthorizedFile, resolveAuthorizedSessionFile } from '../session/sessionPath'
import { PI_TASK_SHORT_ID, resolveSubSessionPath } from './piTaskArtifacts'

export const EXPORT_BUNDLE_VERSION = 1
/** Upper bound on sub-sessions per export; a runaway number means bad parsing. */
const MAX_SUB_SESSIONS = 50
const TASK_ID_CAPTURE = /Task ID:[ \t]*([A-Za-z0-9][A-Za-z0-9._-]{1,120})/g

export interface ExportedFile {
  name: string
  bytes: number
  sha256: string
}

export interface SessionExportBundle {
  outDir: string
  sessionId: string
  files: ExportedFile[]
  subSessionTaskIds: string[]
  warnings: string[]
}

export class SessionExportError extends Error {}

function sha256File(filePath: string): { sha256: string; bytes: number } {
  const content = fs.readFileSync(filePath)
  return { sha256: createHash('sha256').update(content).digest('hex'), bytes: content.length }
}

function assertFreshCopy(source: string, written: string): void {
  const a = fs.readFileSync(source)
  const b = fs.readFileSync(written)
  if (!a.equals(b)) {
    throw new SessionExportError(
      `Exported copy differs from source: ${written}. The session may be active — retry when the session is idle.`
    )
  }
}

/** Task ids referenced by task tool results in the parent conversation. */
export function findSessionTaskIds(sessionPath: string): string[] {
  let raw: string
  try {
    raw = fs.readFileSync(sessionPath, 'utf8')
  } catch (err) {
    throw new SessionExportError(
      `Cannot read session file: ${err instanceof Error ? err.message : String(err)}`
    )
  }
  const ids = new Set<string>()
  for (const match of raw.matchAll(TASK_ID_CAPTURE)) {
    const candidate = match[1] ?? ''
    if (PI_TASK_SHORT_ID.test(candidate)) ids.add(candidate)
    if (ids.size >= MAX_SUB_SESSIONS) break
  }
  return [...ids]
}

/** Session header id from the JSONL `session` line; '' when absent. */
export function readSessionHeaderId(sessionPath: string): string {
  try {
    const content = fs.readFileSync(sessionPath, 'utf8')
    for (const line of content.split('\n')) {
      if (!line.trim()) continue
      const parsed = JSON.parse(line) as { type?: unknown; id?: unknown }
      if (parsed.type === 'session' && typeof parsed.id === 'string') return parsed.id
    }
  } catch {
    // Header is metadata; the copy itself still succeeds without it.
  }
  return ''
}

export interface BuildSessionExportArgs {
  agentDir: string
  /** Active workspace (for `.pi` task artifacts); null skips sub-sessions. */
  workspaceCwd: string | null
  /** Active session file, as known to Electron main. */
  sessionPath: string
  /** Directory the bundle folder is created in (user-picked). Must exist. */
  outRoot: string
}

/**
 * Build the bundle. Throws SessionExportError on authorization failure or
 * filesystem errors; never overwrites an existing bundle directory.
 */
export function buildSessionExportBundle(args: BuildSessionExportArgs): SessionExportBundle {
  const { agentDir, workspaceCwd, outRoot } = args
  if (!existsSyncDir(outRoot)) throw new SessionExportError('Export destination does not exist')

  const sessionFile = authorizeExportSessionFile(() =>
    resolveAuthorizedSessionFile(agentDir, args.sessionPath, ['.jsonl'])
  )
  const sessionId = readSessionHeaderId(sessionFile)
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '')
  const dirName = `openpi-session-export-${sessionId ? sessionId.slice(0, 8) + '-' : ''}${stamp}`
  const outDir = path.join(outRoot, dirName)
  // Exclusive creation: an existing bundle (same second, same session) throws
  // instead of any file inside it ever being overwritten.
  try {
    fs.mkdirSync(outDir)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | null)?.code
    if (code === 'EEXIST') throw new SessionExportError('Export bundle already exists')
    throw err
  }

  const files: ExportedFile[] = []
  const warnings = [
    'This bundle contains raw conversation data: prompts, tool output, and file contents may include secrets, credentials, or private information.',
  ]

  const writeFile = (name: string, source: string): ExportedFile => {
    const target = path.join(outDir, name)
    const parent = path.dirname(target)
    // outDir was created exclusively above; only nested copies need a mkdir.
    if (parent !== outDir) fs.mkdirSync(parent, { recursive: true })
    fs.copyFileSync(source, target)
    assertFreshCopy(source, target)
    const { sha256, bytes } = sha256File(target)
    const file = { name, bytes, sha256 }
    files.push(file)
    return file
  }

  const sessionCopy = writeFile('session.jsonl', sessionFile)
  // Sub-sessions referenced by task results in this conversation. Each copy is
  // named <taskId>.jsonl: pi-task names every sub-session file session.jsonl,
  // so copying basenames would clobber all but the last.
  const subSessions: Array<ExportedFile & { taskId: string }> = []
  const skippedTasks: string[] = []
  if (workspaceCwd) {
    const artifactsDir = path.join(workspaceCwd, '.pi', 'artifacts')
    const taskIds = findSessionTaskIds(sessionFile)
    if (taskIds.length >= MAX_SUB_SESSIONS) {
      warnings.push(
        `Task sub-session cap reached (${MAX_SUB_SESSIONS}); additional tasks were ignored.`
      )
    }
    for (const taskId of taskIds) {
      // A sub-session that cannot be resolved or authorized (SDK background
      // sessions may live outside .pi/artifacts; symlinked paths are refused)
      // is skipped with a warning — one stray task must not kill the export.
      let authorized: string
      try {
        const resolved = resolveSubSessionPath(artifactsDir, taskId)
        if (!resolved) {
          skippedTasks.push(taskId)
          warnings.push(`Sub-session ${taskId} not found; skipped.`)
          continue
        }
        authorized = authorizeExportSessionFile(() =>
          resolveAuthorizedFile(
            resolved,
            [{ anchor: workspaceCwd, root: artifactsDir }],
            ['.jsonl']
          )
        )
      } catch (err) {
        skippedTasks.push(taskId)
        warnings.push(
          `Sub-session ${taskId} skipped: ${err instanceof Error ? err.message : String(err)}`
        )
        continue
      }
      const copy = writeFile(path.join('sub-sessions', `${taskId}.jsonl`), authorized)
      subSessions.push({ ...copy, taskId })
    }
  }
  if (skippedTasks.length > 0) {
    warnings.push(
      `${skippedTasks.length} task sub-session(s) could not be resolved and were skipped.`
    )
  }

  const manifest = {
    exportVersion: EXPORT_BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    exporter: 'OpenPi',
    source: {
      format: 'pi-session-jsonl-v3',
      sessionId,
      fileName: 'session.jsonl',
      ...sessionCopy,
    },
    subSessions: subSessions.map(({ taskId, ...file }) => ({ taskId, ...file })),
    warnings,
  }
  const manifestPath = path.join(outDir, 'manifest.json')
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  fs.writeFileSync(
    path.join(outDir, 'README.txt'),
    [
      'OpenPi session export bundle',
      '',
      `session.jsonl is an exact copy of the Pi session file (JSONL v3 tree:`,
      `parentId links, branches, and compactions preserved).`,
      `sub-sessions/ holds pi-task child sessions referenced by task results.`,
      `manifest.json carries the export version and SHA-256 checksums.`,
      '',
      ...warnings,
      '',
    ].join('\n')
  )

  return {
    outDir,
    sessionId,
    files,
    subSessionTaskIds: subSessions.map((s) => s.taskId),
    warnings,
  }
}

function existsSyncDir(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory()
  } catch {
    return false
  }
}

/** Wrap path-authority errors so callers can distinguish export failures. */
function authorizeExportSessionFile(resolve: () => string): string {
  try {
    return resolve()
  } catch (err) {
    throw new SessionExportError(err instanceof Error ? err.message : String(err))
  }
}
