import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  readCurrentText,
  readSnapshot,
  resolveWorkspacePath,
  safeResolveWorkspacePath,
} from '../electron/services/agentReviewFiles'

let root = ''
let ws = ''
let outside = ''

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-review-'))
  ws = path.join(root, 'ws')
  outside = path.join(root, 'outside')
  fs.mkdirSync(path.join(ws, 'sub'), { recursive: true })
  fs.mkdirSync(outside, { recursive: true })
  fs.writeFileSync(path.join(ws, 'sub', 'a.txt'), 'before')
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret')
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(ws, 'file-link.txt'))
  fs.symlinkSync(outside, path.join(ws, 'link-out'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('safeResolveWorkspacePath', () => {
  it('resolves a relative path and normalizes separators', () => {
    expect(safeResolveWorkspacePath(ws, 'sub/a.txt')).toEqual({
      relPath: 'sub/a.txt',
      fullPath: path.join(ws, 'sub', 'a.txt'),
    })
  })

  it('resolves an absolute path inside the workspace', () => {
    expect(safeResolveWorkspacePath(ws, path.join(ws, 'sub', 'a.txt'))?.relPath).toBe('sub/a.txt')
  })

  it('rejects empty, root, NUL, and escaping candidates', () => {
    expect(safeResolveWorkspacePath(ws, '')).toBeNull()
    expect(safeResolveWorkspacePath(ws, '   ')).toBeNull()
    expect(safeResolveWorkspacePath(ws, '.')).toBeNull()
    expect(safeResolveWorkspacePath(ws, 'a\0b')).toBeNull()
    expect(safeResolveWorkspacePath(ws, '../outside/secret.txt')).toBeNull()
    expect(safeResolveWorkspacePath(ws, path.join(outside, 'secret.txt'))).toBeNull()
  })

  it('rejects a symlinked file that points outside the workspace', () => {
    expect(safeResolveWorkspacePath(ws, 'file-link.txt')).toBeNull()
  })

  it('rejects a path through a symlinked directory', () => {
    expect(safeResolveWorkspacePath(ws, 'link-out/secret.txt')).toBeNull()
  })
})

describe('resolveWorkspacePath', () => {
  it('returns the contained path', () => {
    expect(resolveWorkspacePath(ws, 'sub/a.txt')).toBe(path.join(ws, 'sub', 'a.txt'))
  })

  it('throws on an escaping path', () => {
    expect(() => resolveWorkspacePath(ws, '../outside/secret.txt')).toThrow('Invalid review path')
  })
})

describe('readCurrentText', () => {
  it('reads text and reports a missing file as absent', () => {
    expect(readCurrentText(path.join(ws, 'sub', 'a.txt'))).toEqual({ content: 'before' })
    expect(readCurrentText(path.join(ws, 'sub', 'missing.txt'))).toEqual({ content: null })
  })

  it('skips a binary file', () => {
    const target = path.join(ws, 'sub', 'blob.bin')
    fs.writeFileSync(target, Buffer.from([0x00, 0x01, 0x02]))
    expect(readCurrentText(target)).toEqual({
      content: null,
      skipped: 'Review skipped a binary file',
    })
  })

  it('skips a large file', () => {
    const target = path.join(ws, 'sub', 'big.txt')
    fs.writeFileSync(target, Buffer.alloc(500_001, 0x61))
    expect(readCurrentText(target)).toEqual({
      content: null,
      skipped: 'Review skipped a large file',
    })
  })

  it('skips a directory', () => {
    expect(readCurrentText(path.join(ws, 'sub'))).toEqual({
      content: null,
      skipped: 'Review supports files only',
    })
  })
})

describe('readSnapshot', () => {
  it('captures the before content', () => {
    const resolved = safeResolveWorkspacePath(ws, 'sub/a.txt')
    if (!resolved) throw new Error('expected a resolved path')

    expect(readSnapshot(ws, resolved.relPath, resolved.fullPath)).toEqual({
      cwd: ws,
      relPath: 'sub/a.txt',
      fullPath: path.join(ws, 'sub', 'a.txt'),
      beforeContent: 'before',
      skipped: undefined,
    })
  })
})
