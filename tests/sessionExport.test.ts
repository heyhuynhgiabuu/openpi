/**
 * sessionExport.test.ts — the export bundle must copy the real Pi session
 * JSONL byte-for-byte, link only authorized pi-task sub-sessions, and record
 * SHA-256 checksums. The parent session file must throw on any authorization
 * failure; unresolvable/unauthorized sub-sessions intentionally skip with a
 * per-task warning (one stray task must not kill the export).
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildSessionExportBundle,
  findSessionTaskIds,
  SessionExportError,
} from '../electron/services/sessionExport'

const tmpDirs: string[] = []

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function tmpDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `session-export-${prefix}-`))
  tmpDirs.push(dir)
  return dir
}

function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

const SESSION_ID = 'abcd1234ef567890'
const SESSION_LINES = [
  JSON.stringify({ type: 'session', id: SESSION_ID, cwd: '/unused', version: 3 }),
  JSON.stringify({
    type: 'message',
    id: 'm1',
    parentId: null,
    timestamp: '2026-09-15T00:00:00.000Z',
    message: { role: 'user', content: 'run the fixture task' },
  }),
  JSON.stringify({
    type: 'message',
    id: 'm2',
    parentId: 'm1',
    timestamp: '2026-09-15T00:00:01.000Z',
    message: {
      role: 'toolResult',
      toolCallId: 'tc1',
      content: [{ type: 'text', text: 'Done. Task ID: task-1abc — pass as task_id.' }],
    },
  }),
].join('\n')

interface Fixture {
  home: string
  workspace: string
  sessionFile: string
  subSessionFile: string
}

function writeFixture(): Fixture {
  const home = tmpDir('home')
  const workspace = tmpDir('ws')
  const outRoot = tmpDir('out')
  tmpDirs.push(outRoot)

  const slug = `--${workspace.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`
  const sessionsDir = path.join(home, '.pi', 'agent', 'sessions', slug)
  fs.mkdirSync(sessionsDir, { recursive: true })
  const sessionFile = path.join(sessionsDir, '2026-09-15T00-00-00_test.jsonl')
  fs.writeFileSync(sessionFile, SESSION_LINES)

  const subDir = path.join(workspace, '.pi', 'artifacts', 'tasks', 'sessions', 'task-1abc')
  fs.mkdirSync(subDir, { recursive: true })
  // pi-task names every sub-session file session.jsonl inside its task dir —
  // keep that name so the multi-sub-session test exercises the real clobber risk.
  const subSessionFile = path.join(subDir, 'session.jsonl')
  fs.writeFileSync(
    subSessionFile,
    JSON.stringify({ type: 'session', id: 'sub000000000000', cwd: workspace })
  )
  return { home, workspace, sessionFile, subSessionFile }
}

describe('findSessionTaskIds', () => {
  it('extracts validated task ids from task results', () => {
    const file = path.join(tmpDir('ids'), 's.jsonl')
    fs.writeFileSync(
      file,
      ['Task ID: task-1abc ok', 'Task ID: ../evil', 'Task ID:', 'Task ID: a'].join('\n')
    )
    expect(findSessionTaskIds(file)).toEqual(['task-1abc'])
  })

  it('throws on an unreadable session file', () => {
    expect(() => findSessionTaskIds(path.join(tmpDir('missing'), 'none.jsonl'))).toThrow(
      SessionExportError
    )
  })
})

describe('buildSessionExportBundle', () => {
  // The export authorizes against the PI agent dir (~/.pi/agent), not $HOME.
  const fixtureAgentDir = (fixture: Fixture): string => path.join(fixture.home, '.pi', 'agent')

  it('copies the session and its sub-session byte-identically with a checksummed manifest', () => {
    const fixture = writeFixture()
    const bundle = buildSessionExportBundle({
      agentDir: fixtureAgentDir(fixture),
      workspaceCwd: fixture.workspace,
      sessionPath: fixture.sessionFile,
      outRoot: path.join(tmpDir('out2')),
    })

    const copied = fs.readFileSync(path.join(bundle.outDir, 'session.jsonl'))
    expect(copied.equals(fs.readFileSync(fixture.sessionFile))).toBe(true)
    const subCopied = fs.readFileSync(path.join(bundle.outDir, 'sub-sessions', 'task-1abc.jsonl'))
    expect(subCopied.equals(fs.readFileSync(fixture.subSessionFile))).toBe(true)

    expect(bundle.sessionId).toBe(SESSION_ID)
    expect(bundle.subSessionTaskIds).toEqual(['task-1abc'])
    expect(bundle.files.map((f) => f.name).sort()).toEqual([
      'session.jsonl',
      'sub-sessions/task-1abc.jsonl',
    ])

    const manifest = JSON.parse(
      fs.readFileSync(path.join(bundle.outDir, 'manifest.json'), 'utf8')
    ) as {
      exportVersion: number
      source: { sessionId: string; sha256: string }
      subSessions: Array<{ taskId: string; sha256: string }>
      warnings: string[]
    }
    expect(manifest.exportVersion).toBe(1)
    expect(manifest.source.sessionId).toBe(SESSION_ID)
    expect(manifest.source.sha256).toBe(sha256(SESSION_LINES))
    expect(manifest.subSessions[0]?.taskId).toBe('task-1abc')
    expect(manifest.subSessions[0]?.sha256).toBe(sha256(fs.readFileSync(fixture.subSessionFile)))
    expect(manifest.warnings.some((w) => /secrets/i.test(w))).toBe(true)
    expect(fs.existsSync(path.join(bundle.outDir, 'README.txt'))).toBe(true)
  })

  it('refuses a session file outside the agent sessions root', () => {
    const fixture = writeFixture()
    const outside = path.join(tmpDir('outside'), 'sneaky.jsonl')
    fs.mkdirSync(path.dirname(outside), { recursive: true })
    fs.writeFileSync(outside, SESSION_LINES)
    expect(() =>
      buildSessionExportBundle({
        agentDir: fixtureAgentDir(fixture),
        workspaceCwd: fixture.workspace,
        sessionPath: outside,
        outRoot: tmpDir('out3'),
      })
    ).toThrow(SessionExportError)
  })

  it('refuses a symlinked session file', () => {
    const fixture = writeFixture()
    const link = path.join(tmpDir('link'), 'linked.jsonl')
    fs.mkdirSync(path.dirname(link), { recursive: true })
    fs.symlinkSync(fixture.sessionFile, link)
    expect(() =>
      buildSessionExportBundle({
        agentDir: fixtureAgentDir(fixture),
        workspaceCwd: fixture.workspace,
        sessionPath: link,
        outRoot: tmpDir('out4'),
      })
    ).toThrow(SessionExportError)
  })

  it('never overwrites an existing bundle directory', () => {
    const fixture = writeFixture()
    const args = {
      agentDir: fixtureAgentDir(fixture),
      workspaceCwd: fixture.workspace,
      sessionPath: fixture.sessionFile,
      outRoot: tmpDir('out5'),
    }
    const first = buildSessionExportBundle(args)
    // Same second, same session id → identical bundle name.
    expect(() => buildSessionExportBundle(args)).toThrow(/already exists/)
    expect(fs.existsSync(first.outDir)).toBe(true)
  })

  it('exports multiple sub-sessions without clobbering (each is named session.jsonl upstream)', () => {
    const fixture = writeFixture()
    const sessionFile = path.join(path.dirname(fixture.sessionFile), 'multi.jsonl')
    fs.writeFileSync(
      sessionFile,
      SESSION_LINES.replace('Task ID: task-1abc', 'Task ID: task-1abc and Task ID: task-2def')
    )
    const subDir2 = path.join(
      fixture.workspace,
      '.pi',
      'artifacts',
      'tasks',
      'sessions',
      'task-2def'
    )
    fs.mkdirSync(subDir2, { recursive: true })
    fs.writeFileSync(path.join(subDir2, 'session.jsonl'), '{"marker":"BBB"}\n')

    const bundle = buildSessionExportBundle({
      agentDir: fixtureAgentDir(fixture),
      workspaceCwd: fixture.workspace,
      sessionPath: sessionFile,
      outRoot: tmpDir('out-multi'),
    })

    const names = bundle.files.map((f) => f.name).sort()
    expect(names).toEqual([
      'session.jsonl',
      'sub-sessions/task-1abc.jsonl',
      'sub-sessions/task-2def.jsonl',
    ])
    const first = fs.readFileSync(path.join(bundle.outDir, 'sub-sessions', 'task-1abc.jsonl'))
    const second = fs.readFileSync(path.join(bundle.outDir, 'sub-sessions', 'task-2def.jsonl'))
    expect(first.equals(fs.readFileSync(fixture.subSessionFile))).toBe(true)
    expect(second.equals(Buffer.from('{"marker":"BBB"}\n'))).toBe(true)
    expect(bundle.subSessionTaskIds.sort()).toEqual(['task-1abc', 'task-2def'])
  })

  it('skips a symlinked sub-session directory with a warning instead of failing', () => {
    const fixture = writeFixture()
    const outside = path.join(tmpDir('outside-sub'), 'session.jsonl')
    fs.mkdirSync(path.dirname(outside), { recursive: true })
    fs.writeFileSync(outside, '{"marker":"outside"}\n')
    const taskDir = path.join(
      fixture.workspace,
      '.pi',
      'artifacts',
      'tasks',
      'sessions',
      'task-1abc'
    )
    fs.rmSync(taskDir, { recursive: true, force: true })
    fs.symlinkSync(path.dirname(outside), taskDir, 'dir')

    const bundle = buildSessionExportBundle({
      agentDir: fixtureAgentDir(fixture),
      workspaceCwd: fixture.workspace,
      sessionPath: fixture.sessionFile,
      outRoot: tmpDir('out-symlink'),
    })
    expect(fs.existsSync(path.join(bundle.outDir, 'sub-sessions'))).toBe(false)
    expect(bundle.warnings.some((w) => w.includes('task-1abc') && w.includes('skipped'))).toBe(true)
  })

  it('skips a sub-session that resolves outside the artifacts root with a warning', () => {
    const fixture = writeFixture()
    const notesFile = path.join(fixture.workspace, 'notes', 'session.jsonl')
    fs.mkdirSync(path.dirname(notesFile), { recursive: true })
    fs.writeFileSync(notesFile, '{"marker":"notes"}\n')
    fs.writeFileSync(
      path.join(fixture.workspace, '.pi', 'task-session-history.json'),
      JSON.stringify([{ id: 'task-1abc', sessionRef: '../../notes/session.jsonl' }])
    )

    const bundle = buildSessionExportBundle({
      agentDir: fixtureAgentDir(fixture),
      workspaceCwd: fixture.workspace,
      sessionPath: fixture.sessionFile,
      outRoot: tmpDir('out-outside'),
    })
    expect(fs.existsSync(path.join(bundle.outDir, 'sub-sessions'))).toBe(false)
    expect(bundle.warnings.some((w) => w.includes('task-1abc') && w.includes('skipped'))).toBe(true)
  })

  it('skips unresolvable sub-sessions with a warning instead of failing', () => {
    const fixture = writeFixture()
    const sessionFile = path.join(path.dirname(fixture.sessionFile), 'orphan.jsonl')
    const lines = SESSION_LINES.replace('task-1abc', 'orphan-9xyz')
    fs.writeFileSync(sessionFile, lines)
    const bundle = buildSessionExportBundle({
      agentDir: fixtureAgentDir(fixture),
      workspaceCwd: fixture.workspace,
      sessionPath: sessionFile,
      outRoot: tmpDir('out6'),
    })
    expect(bundle.subSessionTaskIds).toEqual([])
    expect(bundle.warnings.some((w) => w.includes('orphan-9xyz') && w.includes('skipped'))).toBe(
      true
    )
  })
})
