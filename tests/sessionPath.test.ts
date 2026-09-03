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

  it('accepts a not-yet-written session file inside the agent sessions directory', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-session-root-'))
    const agentDir = path.join(tempDir, 'agent')
    const sessions = path.join(agentDir, 'sessions')
    fs.mkdirSync(sessions, { recursive: true })
    const pending = path.join(sessions, 'workspace', 'pending.jsonl')

    expect(
      resolveAuthorizedFile(pending, [{ anchor: agentDir, root: sessions }], ['.jsonl'], {
        allowMissing: true,
      })
    ).toBe(pending)
  })

  it('rejects a missing session file when the caller has not opted into allowMissing', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-session-root-'))
    const agentDir = path.join(tempDir, 'agent')
    const sessions = path.join(agentDir, 'sessions')
    fs.mkdirSync(sessions, { recursive: true })

    expect(() =>
      resolveAuthorizedFile(
        path.join(sessions, 'pending.jsonl'),
        [{ anchor: agentDir, root: sessions }],
        ['.jsonl']
      )
    ).toThrow(/does not exist/i)
  })

  it('rejects a missing session file outside every authorized root even with allowMissing', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-session-root-'))
    tempDir = root
    const agentDir = path.join(root, 'agent')
    const sessions = path.join(agentDir, 'sessions')
    fs.mkdirSync(sessions, { recursive: true })

    expect(() =>
      resolveAuthorizedFile(
        path.join(root, 'outside', 'pending.jsonl'),
        [{ anchor: agentDir, root: sessions }],
        ['.jsonl'],
        { allowMissing: true }
      )
    ).toThrow(/authorized sessions directory/i)
  })

  it('rejects a missing session file reached through a symlinked sessions root', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-session-root-'))
    const agentDir = path.join(tempDir, 'agent')
    const outside = path.join(tempDir, 'outside')
    fs.mkdirSync(agentDir)
    fs.mkdirSync(outside)
    fs.symlinkSync(outside, path.join(agentDir, 'sessions'))

    expect(() =>
      resolveAuthorizedFile(
        path.join(agentDir, 'sessions', 'pending.jsonl'),
        [{ anchor: agentDir, root: path.join(agentDir, 'sessions') }],
        ['.jsonl'],
        { allowMissing: true }
      )
    ).toThrow(/symlink|authorized sessions directory/i)
  })
})
