import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  getSubSessionDir,
  PI_TASK_SHORT_ID,
  resolveSubSessionPath,
} from '../electron/services/piTaskArtifacts'

function makeArtifactsDir(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'openpi-artifacts-'))
  return path.join(root, '.pi', 'artifacts')
}

describe('PI_TASK_SHORT_ID', () => {
  it('accepts valid pi-task short ids (lowercase alphanumeric + dash)', () => {
    expect(PI_TASK_SHORT_ID.test('mqzbadgj-3a1e')).toBe(true)
    expect(PI_TASK_SHORT_ID.test('mqzbj13u-5803')).toBe(true)
    expect(PI_TASK_SHORT_ID.test('019f12ab-cdef')).toBe(true)
  })

  it('rejects path-traversal and malformed ids', () => {
    expect(PI_TASK_SHORT_ID.test('../etc/passwd')).toBe(false)
    expect(PI_TASK_SHORT_ID.test('..\\windows')).toBe(false)
    expect(PI_TASK_SHORT_ID.test('/abs/path')).toBe(false)
    expect(PI_TASK_SHORT_ID.test('foo/bar')).toBe(false)
    expect(PI_TASK_SHORT_ID.test('')).toBe(false)
    expect(PI_TASK_SHORT_ID.test('a'.repeat(81))).toBe(false)
  })
})

describe('getSubSessionDir', () => {
  it('joins artifacts dir, "sessions" and the taskId', () => {
    const dir = getSubSessionDir('/tmp/foo/.pi/artifacts', 'mqzbadgj-3a1e')
    expect(dir).toBe(path.join('/tmp/foo/.pi/artifacts', 'tasks', 'sessions', 'mqzbadgj-3a1e'))
  })
})

describe('resolveSubSessionPath', () => {
  it('returns the only jsonl file in the task directory', () => {
    const artifactsDir = makeArtifactsDir()
    const taskDir = path.join(artifactsDir, 'sessions', 'mqzbadgj-3a1e')
    mkdirSync(taskDir, { recursive: true })
    const file = path.join(
      taskDir,
      '2026-06-29T14-27-08-162Z_019f13c6-df02-70e2-b122-607f386781c1.jsonl'
    )
    writeFileSync(file, '{}\n')

    try {
      expect(resolveSubSessionPath(artifactsDir, 'mqzbadgj-3a1e')).toBe(file)
    } finally {
      rmSync(artifactsDir, { recursive: true, force: true })
    }
  })

  it('picks the first jsonl when multiple exist (defensive: pi-task writes one)', () => {
    const artifactsDir = makeArtifactsDir()
    const taskDir = path.join(artifactsDir, 'sessions', 'mqzbadgj-3a1e')
    mkdirSync(taskDir, { recursive: true })
    const a = path.join(taskDir, 'a.jsonl')
    const b = path.join(taskDir, 'b.jsonl')
    writeFileSync(a, '')
    writeFileSync(b, '')

    try {
      const resolved = resolveSubSessionPath(artifactsDir, 'mqzbadgj-3a1e')
      expect(resolved).toBeTruthy()
      expect([a, b]).toContain(resolved)
    } finally {
      rmSync(artifactsDir, { recursive: true, force: true })
    }
  })

  it('returns null when the task directory is missing', () => {
    const artifactsDir = makeArtifactsDir()
    try {
      expect(resolveSubSessionPath(artifactsDir, 'mqzbadgj-3a1e')).toBeNull()
    } finally {
      rmSync(artifactsDir, { recursive: true, force: true })
    }
  })

  it('returns null when the task directory has no jsonl files', () => {
    const artifactsDir = makeArtifactsDir()
    const taskDir = path.join(artifactsDir, 'sessions', 'mqzbadgj-3a1e')
    mkdirSync(taskDir, { recursive: true })
    writeFileSync(path.join(taskDir, 'README.md'), '')

    try {
      expect(resolveSubSessionPath(artifactsDir, 'mqzbadgj-3a1e')).toBeNull()
    } finally {
      rmSync(artifactsDir, { recursive: true, force: true })
    }
  })

  it('returns null for malformed taskId (path-traversal defense)', () => {
    const artifactsDir = makeArtifactsDir()
    try {
      expect(resolveSubSessionPath(artifactsDir, '../etc/passwd')).toBeNull()
      expect(resolveSubSessionPath(artifactsDir, '')).toBeNull()
      expect(resolveSubSessionPath(artifactsDir, 'foo/bar')).toBeNull()
    } finally {
      rmSync(artifactsDir, { recursive: true, force: true })
    }
  })
})
