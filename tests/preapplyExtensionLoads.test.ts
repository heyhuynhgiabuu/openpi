import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The pre-apply gate must reach a *trusted* workspace, which is the ordinary user and the one
 * issue #80 was filed for. This drives Pi's real loader through `getResourceLoader`, because the
 * two places that decide it (`sidecarContext.ts` building the paths list, and
 * `shippedPreapplyPathFor` choosing the shipped copy) can each be reverted with the source-regex
 * test still green — so only the loaded result is worth asserting on.
 *
 * `getAgentDir` reads `os.homedir()`, so HOME is redirected to an empty dir per test to keep the
 * developer's own `~/.pi/agent` extensions out of the count.
 */

vi.mock('electron', () => ({ app: { isPackaged: true } }))

const repoRoot = path.resolve(import.meta.dirname, '..')
const gateDir = path.join(repoRoot, '.pi/extensions/openpi-preapply-review')

let home: string
let resources: string
let workspace: string
const originalHome = process.env.HOME

function writeGate(dir: string, source: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'index.ts'), source)
}

/** A minimal gate: registers one `tool_call` handler when the env flag is on. */
const STAND_IN_GATE = `export default function (pi) {
  if (process.env.OPENPI_PREAPPLY_REVIEW !== '1') return
  pi.on('tool_call', () => undefined)
}
`

beforeEach(() => {
  home = mkdtempSync(path.join(os.tmpdir(), 'openpi-home-'))
  resources = mkdtempSync(path.join(os.tmpdir(), 'openpi-res-'))
  workspace = mkdtempSync(path.join(os.tmpdir(), 'openpi-ws-'))
  process.env.HOME = home
  process.env.OPENPI_RESOURCES_PATH = resources
  process.env.OPENPI_PREAPPLY_REVIEW = '1'
})

afterEach(() => {
  process.env.HOME = originalHome
  delete process.env.OPENPI_RESOURCES_PATH
  delete process.env.OPENPI_PREAPPLY_REVIEW
  for (const dir of [home, resources, workspace]) rmSync(dir, { recursive: true, force: true })
})

async function loadGate(cwd: string, trusted: boolean) {
  const { clearResourceLoaderCache, getResourceLoader } =
    await import('../electron/pi/sidecarContext')
  // The loader is cached per (cwd, trusted), so a stale entry would hide the case under test.
  clearResourceLoaderCache()
  const loader = await getResourceLoader(cwd, trusted)
  const loaded = loader.getExtensions()
  const gates = loaded.extensions.filter((extension) =>
    extension.resolvedPath.includes('openpi-preapply-review')
  )
  return { gates, errors: loaded.errors }
}

describe('the shipped gate reaches Pi through the real loader (#80)', () => {
  it('loads for a trusted workspace with no copy of its own', async () => {
    // The ordinary user. If the shipped path stops being added for trusted workspaces, this is
    // issue #80 again: the gate is silently off.
    const shipped = path.join(resources, 'extensions', 'openpi-preapply-review')
    writeGate(shipped, STAND_IN_GATE)

    const { gates, errors } = await loadGate(workspace, true)

    expect(errors).toEqual([])
    expect(gates).toHaveLength(1)
    expect(gates[0]?.resolvedPath).toBe(path.join(shipped, 'index.ts'))
    expect(gates[0]?.handlers.get('tool_call')).toHaveLength(1)
  })

  it('loads once, not twice, when a trusted workspace already has its own copy', async () => {
    // Both copies are distinct files and Pi dedupes by realpath, so handing it both would give
    // the user two prompts per edit.
    const shipped = path.join(resources, 'extensions', 'openpi-preapply-review')
    writeGate(shipped, STAND_IN_GATE)
    const project = path.join(workspace, '.pi', 'extensions', 'openpi-preapply-review')
    writeGate(project, STAND_IN_GATE)

    const { gates, errors } = await loadGate(workspace, true)

    expect(errors).toEqual([])
    expect(gates).toHaveLength(1)
    // The project copy wins, as it did before the gate was shipped.
    expect(gates[0]?.resolvedPath).toBe(path.join(project, 'index.ts'))
    expect(gates[0]?.handlers.get('tool_call')).toHaveLength(1)
  })

  it('still loads the shipped copy for an untrusted workspace that has its own', async () => {
    // Pi does not load an untrusted workspace's extensions, so its copy cannot stand in.
    const shipped = path.join(resources, 'extensions', 'openpi-preapply-review')
    writeGate(shipped, STAND_IN_GATE)
    writeGate(path.join(workspace, '.pi', 'extensions', 'openpi-preapply-review'), STAND_IN_GATE)

    const { gates } = await loadGate(workspace, false)

    expect(gates).toHaveLength(1)
    expect(gates[0]?.resolvedPath).toBe(path.join(shipped, 'index.ts'))
  })

  it('loads the real extension files end to end, preview imports included', async () => {
    // Copies the actual gate (index.ts + its ./preview import) instead of a stand-in, so the
    // packaged copy is proven to load, not just the fixture.
    cpSync(gateDir, path.join(resources, 'extensions', 'openpi-preapply-review'), {
      recursive: true,
    })

    const { gates, errors } = await loadGate(workspace, true)

    expect(errors).toEqual([])
    expect(gates).toHaveLength(1)
    expect(gates[0]?.handlers.get('tool_call')).toHaveLength(1)
    expect(gates[0]?.handlers.get('session_start')).toHaveLength(1)
  })
})
