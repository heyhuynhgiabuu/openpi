import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-wt-'))
process.env.OPENPI_AGENT_DIR = tmpHome

const syncFile = path.join(tmpHome, '.openpi-workspace-trust.json')
const { setWorkspaceTrustSync, clearWorkspaceTrustSync } = await import(
  '../electron/services/workspaceTrustSync'
)

function readMap(): Record<string, 'trusted' | 'untrusted'> {
  try {
    return JSON.parse(fs.readFileSync(syncFile, 'utf-8'))
  } catch {
    return {}
  }
}

describe('workspaceTrustSync', () => {
  beforeEach(() => {
    try {
      fs.unlinkSync(syncFile)
    } catch {
      /* ignore */
    }
  })

  afterEach(() => {
    try {
      fs.unlinkSync(syncFile)
    } catch {
      /* ignore */
    }
  })

  it('writes a single cwd decision to the sync file', () => {
    setWorkspaceTrustSync('/repo/a', 'trusted')
    expect(readMap()).toEqual({ '/repo/a': 'trusted' })
  })

  it('merges multiple cwd decisions', () => {
    setWorkspaceTrustSync('/repo/a', 'trusted')
    setWorkspaceTrustSync('/repo/b', 'untrusted')
    expect(readMap()).toEqual({ '/repo/a': 'trusted', '/repo/b': 'untrusted' })
  })

  it('updates an existing cwd decision', () => {
    setWorkspaceTrustSync('/repo/a', 'trusted')
    setWorkspaceTrustSync('/repo/a', 'untrusted')
    expect(readMap()).toEqual({ '/repo/a': 'untrusted' })
  })

  it('clears a single cwd decision', () => {
    setWorkspaceTrustSync('/repo/a', 'trusted')
    clearWorkspaceTrustSync('/repo/a')
    expect(readMap()).toEqual({})
  })
})
