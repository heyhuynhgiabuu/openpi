import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { discoverAndLoadExtensions } from '@earendil-works/pi-coding-agent'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const extensionDir = path.resolve(import.meta.dirname, '../.pi/extensions/openpi-preapply-review')
const entryPath = path.join(extensionDir, 'index.ts')

let cwd: string
let agentDir: string

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-load-cwd-'))
  agentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-load-agent-'))
})

afterEach(() => {
  fs.rmSync(cwd, { recursive: true, force: true })
  fs.rmSync(agentDir, { recursive: true, force: true })
  delete process.env.OPENPI_PREAPPLY_REVIEW
})

/**
 * The unit tests call the gate directly. This runs the real file through Pi's
 * extension loader, which is the only thing that proves Pi accepts it: the TS
 * transpile, the default export shape, and the env gate read at load time.
 * Temp cwd/agentDir keep the other project extensions out of the process.
 */
describe('pre-apply review extension under Pi extension loader', () => {
  async function load() {
    // Loading the directory exercises Pi's own entry resolution (index.ts), which
    // is how the extension is discovered in a real session.
    const result = await discoverAndLoadExtensions([extensionDir], cwd, agentDir)
    return {
      errors: result.errors,
      extension: result.extensions.find((candidate) => candidate.resolvedPath === entryPath),
    }
  }

  it('loads and registers a tool_call handler when the gate is on', async () => {
    process.env.OPENPI_PREAPPLY_REVIEW = '1'

    const { errors, extension } = await load()

    expect(errors).toEqual([])
    expect(extension?.handlers.get('tool_call')).toHaveLength(1)
    expect(extension?.handlers.get('turn_end')).toHaveLength(1)
    // A replacement session must not inherit the turn-scoped skip.
    expect(extension?.handlers.get('session_start')).toHaveLength(1)
  })

  it('loads inert when the gate is off', async () => {
    const { errors, extension } = await load()

    expect(errors).toEqual([])
    expect(extension?.handlers.size).toBe(0)
  })
})
