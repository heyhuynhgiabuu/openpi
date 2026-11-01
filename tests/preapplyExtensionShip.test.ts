import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  existingPreapplyExtensionPath,
  shippedPreapplyPathFor,
} from '../electron/pi/preapplyExtension'

/**
 * Issue #80: the pre-apply gate was a Pi *project* extension only, so a packed app had it
 * only when the user's workspace happened to be a checkout of OpenPi. These tests pin the two
 * things that make it reach every user: the files are listed for packaging, and the sidecar
 * can find them without importing `electron` (which its bundle forbids).
 */

let resourcesDir: string

beforeEach(() => {
  resourcesDir = mkdtempSync(path.join(os.tmpdir(), 'openpi-resources-'))
})

afterEach(() => {
  rmSync(resourcesDir, { recursive: true, force: true })
})

describe('shipped pre-apply extension (#80)', () => {
  it('is listed for packaging, so a packed build actually contains it', async () => {
    const { readFile } = await import('node:fs/promises')
    const config = JSON.parse(
      await readFile(path.join(import.meta.dirname, '../electron-builder.json'), 'utf-8')
    )

    expect(config.extraResources ?? []).toContainEqual({
      from: '.pi/extensions/openpi-preapply-review',
      to: 'extensions/openpi-preapply-review',
    })
  })

  it('finds the entry file in the packaged resources directory', async () => {
    const target = path.join(resourcesDir, 'extensions', 'openpi-preapply-review')
    mkdirSync(target, { recursive: true })
    const entry = path.join(target, 'index.ts')
    await (await import('node:fs/promises')).writeFile(entry, 'export default 1\n')

    const found = existingPreapplyExtensionPath({ OPENPI_RESOURCES_PATH: resourcesDir })

    expect(found).toBe(entry)
  })

  it('reports nothing when the packaged files are missing, instead of a broken path', () => {
    // A missing path makes Pi report `Extension path does not exist` for every session.
    const found = existingPreapplyExtensionPath({ OPENPI_RESOURCES_PATH: resourcesDir })

    expect(found).toBeUndefined()
  })

  it('does nothing in a dev run, where Pi discovers the source tree itself', () => {
    // Nothing sets the resources path outside a packaged build, and the checkout already has
    // `.pi/extensions`, so returning undefined is the normal case — and avoids a second copy.
    // The working directory must not stand in for it: `process.cwd()` is some unrelated
    // project when the app runs, and a hit there would load a stranger's file as the gate.
    expect(existingPreapplyExtensionPath({})).toBeUndefined()
    const decoy = path.join(process.cwd(), 'extensions', 'openpi-preapply-review')
    mkdirSync(decoy, { recursive: true })
    writeFileSync(path.join(decoy, 'index.ts'), 'export default 1\n')
    try {
      expect(existingPreapplyExtensionPath({})).toBeUndefined()
    } finally {
      rmSync(path.join(process.cwd(), 'extensions'), { recursive: true, force: true })
    }
  })

  it('keeps the sidecar bundle free of electron, which the guard test enforces', async () => {
    const { readFile } = await import('node:fs/promises')
    const source = await readFile(
      path.join(import.meta.dirname, '../electron/pi/preapplyExtension.ts'),
      'utf-8'
    )

    expect(source).not.toMatch(/from 'electron'/)
    expect(source).not.toMatch(/services\/shellEnv/)
  })

  it('is added to the loader paths in BOTH trust branches', async () => {
    // The trusted branch used to pass `[]`, so a trusted workspace got no shipped gate at all.
    const { readFile } = await import('node:fs/promises')
    const source = await readFile(
      path.join(import.meta.dirname, '../electron/pi/sidecarContext.ts'),
      'utf-8'
    )

    expect(source).toMatch(/shippedPreapplyPathFor\(\{ workspacePath: cwd, workspaceTrusted \}\)/)
    expect(source).toMatch(/\.\.\.\(shippedPreapply \? \[shippedPreapply\] : \[\]\)/)
  })

  describe('when the workspace supplies its own copy', () => {
    function packaged(workspace: string, trusted: boolean) {
      const resources = mkdtempSync(path.join(os.tmpdir(), 'openpi-res-'))
      const shippedDir = path.join(resources, 'extensions', 'openpi-preapply-review')
      mkdirSync(shippedDir, { recursive: true })
      writeFileSync(path.join(shippedDir, 'index.ts'), 'export default 1\n')
      return {
        resources,
        run: () =>
          shippedPreapplyPathFor({
            workspacePath: workspace,
            workspaceTrusted: trusted,
            env: { OPENPI_RESOURCES_PATH: resources },
          }),
      }
    }

    it('leaves the shipped copy out, so the user is not prompted twice', () => {
      // Pi dedupes by realpath; the shipped file and the checkout's file are different files,
      // so passing both loaded the gate twice — two prompts per edit.
      const workspace = mkdtempSync(path.join(os.tmpdir(), 'openpi-ws-'))
      const projectDir = path.join(workspace, '.pi', 'extensions', 'openpi-preapply-review')
      mkdirSync(projectDir, { recursive: true })
      writeFileSync(path.join(projectDir, 'index.ts'), 'export default 1\n')
      const setup = packaged(workspace, true)
      try {
        expect(setup.run()).toBeUndefined()
      } finally {
        rmSync(workspace, { recursive: true, force: true })
        rmSync(setup.resources, { recursive: true, force: true })
      }
    })

    it('still ships when the workspace copy exists but the workspace is untrusted', () => {
      // Pi does not load an untrusted workspace's extensions, so that copy cannot stand in.
      const workspace = mkdtempSync(path.join(os.tmpdir(), 'openpi-ws-'))
      const projectDir = path.join(workspace, '.pi', 'extensions', 'openpi-preapply-review')
      mkdirSync(projectDir, { recursive: true })
      writeFileSync(path.join(projectDir, 'index.ts'), 'export default 1\n')
      const setup = packaged(workspace, false)
      try {
        expect(setup.run()).toContain(path.join('extensions', 'openpi-preapply-review', 'index.ts'))
      } finally {
        rmSync(workspace, { recursive: true, force: true })
        rmSync(setup.resources, { recursive: true, force: true })
      }
    })
  })
})
