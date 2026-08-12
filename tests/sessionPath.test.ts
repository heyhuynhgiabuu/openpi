import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveAuthorizedFile } from '../electron/session/sessionPath'

describe('session file roots', () => {
  let tempDir: string | undefined

  afterEach(() => {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true })
    tempDir = undefined
  })

  it('rejects a workspace artifact root reached through a symlinked .pi directory', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-session-root-'))
    const workspace = path.join(tempDir, 'workspace')
    const outside = path.join(tempDir, 'outside')
    const outsideArtifacts = path.join(outside, 'artifacts')
    fs.mkdirSync(workspace)
    fs.mkdirSync(outsideArtifacts, { recursive: true })
    const sessionFile = path.join(outsideArtifacts, 'session.jsonl')
    fs.writeFileSync(sessionFile, '{}\n')
    fs.symlinkSync(outside, path.join(workspace, '.pi'))

    expect(() =>
      resolveAuthorizedFile(
        path.join(workspace, '.pi', 'artifacts', 'session.jsonl'),
        [{ anchor: workspace, root: path.join(workspace, '.pi', 'artifacts') }],
        ['.jsonl']
      )
    ).toThrow(/symlink|authorized sessions directory/i)
  })

  it('rejects an agent sessions directory that is itself a symlink', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-session-root-'))
    const agentDir = path.join(tempDir, 'agent')
    const outside = path.join(tempDir, 'outside')
    fs.mkdirSync(agentDir)
    fs.mkdirSync(outside)
    const sessionFile = path.join(outside, 'session.jsonl')
    fs.writeFileSync(sessionFile, '{}\n')
    fs.symlinkSync(outside, path.join(agentDir, 'sessions'))

    expect(() =>
      resolveAuthorizedFile(
        path.join(agentDir, 'sessions', 'session.jsonl'),
        [{ anchor: agentDir, root: path.join(agentDir, 'sessions') }],
        ['.jsonl']
      )
    ).toThrow(/symlink|authorized sessions directory/i)
  })
})
