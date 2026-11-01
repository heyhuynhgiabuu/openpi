import { existsSync } from 'node:fs'
import path from 'node:path'

/**
 * Where the pre-apply review extension lives on disk, as an absolute path.
 *
 * The gate is a Pi *project* extension, so Pi only discovers it at
 * `<workspace>/.pi/extensions/`. That means a packed app only has the gate when the user's
 * workspace happens to be a checkout of OpenPi, which is never true for a user (issue #80).
 * The files therefore ship in `extraResources` and the sidecar hands Pi their path directly,
 * so the gate exists in every workspace, trusted or not.
 *
 * Passed as the entry *file*, not the directory: Pi's loader resolves a directory through
 * package discovery (`package.json` `pi` manifest or an `extensions/` subdirectory) and
 * otherwise falls back to `jiti.import(directory)`, which this repo already documents as
 * failing. `tests/preApplyExtensionLoad.test.ts` loads this entry file through Pi's real
 * loader, so the file form is the one with evidence behind it.
 *
 * This module must not import `electron`: it is reached from the sidecar bundle, and
 * `tests/sidecarBundle.test.ts` fails if that bundle can reach `electron` at all. The
 * resources directory therefore arrives as `OPENPI_RESOURCES_PATH`, set by main before the
 * fork — main already reads `app.isPackaged` in `sidecarHost.ts`.
 */
const ENTRY = 'index.ts'
const DIR = 'openpi-preapply-review'
const RESOURCES_ENV = 'OPENPI_RESOURCES_PATH'

/**
 * The entry path, or `undefined` when nothing is shipped or the file is not there.
 *
 * A missing path handed to `additionalExtensionPaths` makes the loader report
 * `Extension path does not exist` for every session, so absence is reported as `undefined`
 * instead. In a dev run no resources directory is set and Pi discovers the source tree
 * itself, so `undefined` is the normal case there. When the gate is enabled but the files are
 * missing it is simply off; `tests/preapplyExtensionShip.test.ts` is what catches that
 * packaging regression, not a runtime warning.
 */
export function existingPreapplyExtensionPath(
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  const resources = env[RESOURCES_ENV]
  if (!resources) return undefined
  const entry = path.join(resources, 'extensions', DIR, ENTRY)
  return existsSync(entry) ? entry : undefined
}

/** A workspace's own copy of the gate, which Pi discovers from `<cwd>/.pi/extensions`. */
export function workspacePreapplyExtensionPath(workspacePath: string): string {
  return path.join(workspacePath, '.pi', 'extensions', DIR, ENTRY)
}

/**
 * The shipped path to hand Pi, or `undefined` when it must not be added.
 *
 * Omitted when the workspace supplies its own copy: Pi dedupes extensions by realpath, and
 * these are two different files, so passing both loads the gate twice and the user gets two
 * prompts per edit. The project copy wins, which is how a checkout behaved before the
 * shipped copy existed.
 */
export function shippedPreapplyPathFor(options: {
  workspacePath: string
  workspaceTrusted: boolean
  env?: NodeJS.ProcessEnv
}): string | undefined {
  const shipped = existingPreapplyExtensionPath(options.env ?? process.env)
  if (!shipped) return undefined
  // An untrusted workspace's extensions are not loaded by Pi, so its copy cannot stand in.
  if (!options.workspaceTrusted) return shipped
  return existsSync(workspacePreapplyExtensionPath(options.workspacePath)) ? undefined : shipped
}
