/**
 * Build and layout half of the shipped-path harness: bundles the real sidecar
 * entry like the electron-vite build and lays out the temp HOME and workspace
 * the child runs against.
 *
 * Only the model boundary is scripted: tests/fixtures/scripted-provider-extension.js
 * is installed as an extension (project or global, see `providerScope`), so the
 * provider is discovered through the same route a real extension takes. The
 * optional hold extension (tests/fixtures/scripted-hold-extension.js) installs
 * next to it for the run-start / steer / follow-up / abort tests.
 *
 * Isolation follows shippedPath.test.ts: HOME/USERPROFILE point at a fresh temp
 * dir, so the developer's real ~/.pi/agent is never touched.
 */
import fs from 'node:fs'
import path from 'node:path'
// Transitive dep of vite/electron-vite, declared in devDependencies for this
// test: reused so the test bundles the sidecar entry like the real build.
import { build as esbuildBuild } from 'esbuild'

export interface HarnessSettings {
  defaultTools?: string[]
  extensions?: string[]
}

export interface SidecarHarnessOptions {
  /** Names the bundle and workspace cache dir. Test files use distinct names. */
  cacheName: string
  /** Written to <workspace>/.pi/settings.json when given. */
  projectSettings?: HarnessSettings
  /** Written to <HOME>/.pi/agent/settings.json when given. */
  globalSettings?: HarnessSettings
  /** Trust passed to start_session. Defaults to trusted. */
  workspaceTrusted?: boolean
  /**
   * Where the scripted provider is installed. `project` loads it from
   * <workspace>/.pi/extensions (trusted only); `global` from
   * <HOME>/.pi/agent/extensions, which loads regardless of trust.
   */
  providerScope?: 'project' | 'global'
  /**
   * Also installs the hold extension: a second scripted provider whose turns,
   * tool and run start can be parked until released (see its header).
   */
  holdExtension?: boolean
}

export const REPO_ROOT = process.cwd()
const SIDECAR_ENTRY = path.join(REPO_ROOT, 'electron', 'pi', 'sidecar.ts')
const FIXTURES_DIR = path.join(REPO_ROOT, 'tests', 'fixtures')
const PROVIDER_FIXTURE = path.join(FIXTURES_DIR, 'scripted-provider-extension.js')
const HOLD_FIXTURE = path.join(FIXTURES_DIR, 'scripted-hold-extension.js')

async function bundleSidecar(bundle: string): Promise<void> {
  fs.mkdirSync(path.dirname(bundle), { recursive: true })
  await esbuildBuild({
    entryPoints: [SIDECAR_ENTRY],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    target: 'node20',
    logLevel: 'silent',
  })
}

function writeJson(file: string, value: HarnessSettings): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value))
}

/** Lays out HOME and the workspace: the provider fixtures and any settings files. */
function layoutFixtures(home: string, workspace: string, options: SidecarHarnessOptions): void {
  const providerDir =
    options.providerScope === 'global'
      ? path.join(home, '.pi', 'agent', 'extensions')
      : path.join(workspace, '.pi', 'extensions')
  fs.mkdirSync(providerDir, { recursive: true })
  fs.copyFileSync(PROVIDER_FIXTURE, path.join(providerDir, 'scripted-provider.js'))
  if (options.holdExtension) {
    fs.copyFileSync(HOLD_FIXTURE, path.join(providerDir, 'scripted-hold.js'))
  }
  if (options.projectSettings) {
    writeJson(path.join(workspace, '.pi', 'settings.json'), options.projectSettings)
  }
  if (options.globalSettings) {
    writeJson(path.join(home, '.pi', 'agent', 'settings.json'), options.globalSettings)
  }
}

export interface Sandbox {
  bundle: string
  /** The child's HOME: session files must land under it. */
  home: string
  workspace: string
}

/**
 * Bundles the sidecar, then creates the temp HOME and workspace. Bundling comes
 * first: a failed build must not leave temp dirs behind.
 *
 * HOME and workspace both live under the repo cache: the fixtures'
 * `@earendil-works/pi-ai` import resolves from the repo's node_modules only when
 * the extension sits inside the repo tree, wherever it is installed. The real
 * ~/.pi/agent is still never touched: HOME is a fresh temp dir.
 */
export async function createSandbox(options: SidecarHarnessOptions): Promise<Sandbox> {
  const cacheDir = path.join(
    REPO_ROOT,
    'node_modules',
    '.cache',
    `openpi-shipped-${options.cacheName}`
  )
  const bundle = path.join(cacheDir, 'piSidecar.mjs')
  await bundleSidecar(bundle)
  const home = fs.mkdtempSync(path.join(cacheDir, 'home-'))
  const workspace = fs.mkdtempSync(path.join(cacheDir, 'workspace-'))
  layoutFixtures(home, workspace, options)
  return { bundle, home, workspace }
}

/** Removes the temp HOME and workspace; retries absorb Windows EBUSY/EPERM from closing handles. */
export function removeSandbox(sandbox: Sandbox): void {
  for (const dir of [sandbox.home, sandbox.workspace]) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}
