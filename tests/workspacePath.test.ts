import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  moveWorkspaceEntryNoReplace,
  readWorkspaceBytes,
  readWorkspaceFile,
  resolveWorkspacePath,
  writeWorkspaceBytes,
  writeWorkspaceFile,
} from '../electron/services/workspacePath'

let root = ''
let ws = ''
let outside = ''

function setup(): void {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-wspath-'))
  ws = path.join(root, 'ws')
  outside = path.join(root, 'outside')
  fs.mkdirSync(path.join(ws, 'sub'), { recursive: true })
  fs.mkdirSync(outside, { recursive: true })
  fs.writeFileSync(path.join(ws, 'sub', 'a.txt'), 'inside')
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret')
  fs.symlinkSync(outside, path.join(ws, 'link-out'))
  fs.symlinkSync(path.join(ws, 'sub'), path.join(ws, 'link-in'))
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(ws, 'file-link.txt'))
}

beforeEach(setup)

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('resolveWorkspacePath', () => {
  it('resolves a nested path inside the workspace', () => {
    expect(resolveWorkspacePath(ws, 'sub/a.txt', 'read')).toBe(path.join(ws, 'sub', 'a.txt'))
  })

  it('resolves a path whose parents do not exist yet', () => {
    expect(resolveWorkspacePath(ws, 'new/deep/file.txt', 'write')).toBe(
      path.join(ws, 'new', 'deep', 'file.txt')
    )
  })

  it('refuses to leave the workspace', () => {
    expect(() => resolveWorkspacePath(ws, '../outside/secret.txt', 'read')).toThrow(
      'Refusing to read outside workspace'
    )
    expect(() => resolveWorkspacePath(ws, path.join(outside, 'secret.txt'), 'read')).toThrow(
      'outside workspace'
    )
  })

  it('refuses the workspace root itself', () => {
    expect(() => resolveWorkspacePath(ws, '', 'read')).toThrow('outside workspace')
    expect(() => resolveWorkspacePath(ws, '.', 'read')).toThrow('outside workspace')
  })

  it('refuses a path through a symlink, even one that stays inside', () => {
    expect(() => resolveWorkspacePath(ws, 'link-out/x.txt', 'read')).toThrow(
      'through a symlinked path'
    )
    expect(() => resolveWorkspacePath(ws, 'link-in/a.txt', 'read')).toThrow(
      'through a symlinked path'
    )
    expect(() => resolveWorkspacePath(ws, 'file-link.txt', 'read')).toThrow(
      'through a symlinked path'
    )
  })

  it('refuses a new file under a symlinked parent', () => {
    expect(() => resolveWorkspacePath(ws, 'link-out/new.txt', 'write')).toThrow(
      'through a symlinked path'
    )
  })
})

describe('readWorkspaceBytes', () => {
  it('reads a contained file', () => {
    expect(readWorkspaceFile(path.join(ws, 'sub', 'a.txt'), ws)).toBe('inside')
  })

  it('refuses to follow a symlinked file', () => {
    // POSIX raises ELOOP from O_NOFOLLOW; Windows has no O_NOFOLLOW and the
    // not-a-file check refuses instead. Both must refuse, so neither errno nor
    // message is pinned beyond that.
    expect(() => readWorkspaceBytes(path.join(ws, 'file-link.txt'), ws)).toThrow(/ELOOP|not a file/)
  })

  it('refuses a directory', () => {
    expect(() => readWorkspaceBytes(ws, ws)).toThrow('Refusing to open a path that is not a file')
  })
})

describe('writeWorkspaceBytes', () => {
  it('truncates when the new content is shorter', () => {
    writeWorkspaceFile(path.join(ws, 'sub', 'a.txt'), 'longer content', ws)
    writeWorkspaceFile(path.join(ws, 'sub', 'a.txt'), 'short', ws)
    expect(fs.readFileSync(path.join(ws, 'sub', 'a.txt'), 'utf-8')).toBe('short')
  })

  it('refuses to overwrite when exclusive', () => {
    const target = path.join(ws, 'sub', 'a.txt')
    expect(() => writeWorkspaceBytes(target, Buffer.from('x'), ws, { exclusive: true })).toThrow(
      /EEXIST/
    )
  })

  it('refuses to write through a symlink', () => {
    // The refusal is checked before the truncate, so the target stays intact on
    // every platform — that is the property worth pinning, not the errno.
    expect(() => writeWorkspaceFile(path.join(ws, 'file-link.txt'), 'x', ws)).toThrow(
      /ELOOP|not a file/
    )
    expect(fs.readFileSync(path.join(outside, 'secret.txt'), 'utf-8')).toBe('secret')
  })
})

describe('moveWorkspaceEntryNoReplace', () => {
  it('moves a file', () => {
    const source = path.join(ws, 'sub', 'a.txt')
    const target = path.join(ws, 'sub', 'b.txt')
    moveWorkspaceEntryNoReplace(source, target)
    expect(fs.existsSync(source)).toBe(false)
    expect(fs.readFileSync(target, 'utf-8')).toBe('inside')
  })

  it('moves a directory', () => {
    const source = path.join(ws, 'sub')
    const target = path.join(ws, 'moved')
    moveWorkspaceEntryNoReplace(source, target)
    expect(fs.readFileSync(path.join(target, 'a.txt'), 'utf-8')).toBe('inside')
  })

  it('refuses an existing target', () => {
    fs.writeFileSync(path.join(ws, 'sub', 'b.txt'), 'taken')
    // A file target is refused by the atomic link, a directory target by the check.
    expect(() =>
      moveWorkspaceEntryNoReplace(path.join(ws, 'sub', 'a.txt'), path.join(ws, 'sub', 'b.txt'))
    ).toThrow(/EEXIST/)
    expect(() => moveWorkspaceEntryNoReplace(path.join(ws, 'sub'), path.join(ws, 'sub'))).toThrow(
      'Target already exists'
    )
  })
})
