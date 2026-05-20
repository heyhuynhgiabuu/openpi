import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  checkProtectedPath,
  filterBlockedPaths,
  isHardBlocked,
} from '../electron/services/protectedPaths'

const HOME = os.homedir()

describe('checkProtectedPath', () => {
  it('hard-blocks paths inside ~/.ssh', () => {
    const result = checkProtectedPath(path.join(HOME, '.ssh', 'id_rsa'))
    expect(result).not.toBeNull()
    expect(result?.level).toBe('hard')
    expect(result?.rule).toBe('ssh-dir')
  })

  it('hard-blocks paths inside ~/.gnupg', () => {
    const result = checkProtectedPath(path.join(HOME, '.gnupg', 'secring.gpg'))
    expect(result).not.toBeNull()
    expect(result?.level).toBe('hard')
  })

  it('soft-blocks ~/.zshrc', () => {
    const result = checkProtectedPath(path.join(HOME, '.zshrc'))
    expect(result).not.toBeNull()
    expect(result?.level).toBe('soft')
  })

  it('soft-blocks ~/.gitconfig', () => {
    const result = checkProtectedPath(path.join(HOME, '.gitconfig'))
    expect(result).not.toBeNull()
    expect(result?.level).toBe('soft')
  })

  it('scope-blocks paths outside workspace', () => {
    const workspace = path.join(HOME, 'my-project')
    const outside = path.join(HOME, 'other-project', 'file.txt')
    const result = checkProtectedPath(outside, workspace)
    expect(result).not.toBeNull()
    expect(result?.level).toBe('scope')
    expect(result?.rule).toBe('outside-workspace')
  })

  it('passes paths inside workspace', () => {
    const workspace = path.join(HOME, 'my-project')
    const inside = path.join(workspace, 'src', 'index.ts')
    // A file inside workspace is not protected (assuming not in a hard/soft rule path)
    const result = checkProtectedPath(inside, workspace)
    expect(result).toBeNull()
  })

  it('passes an ordinary source file with no workspace', () => {
    const result = checkProtectedPath('/tmp/some-project/src/app.ts')
    expect(result).toBeNull()
  })

  it('hard-blocks .git/objects paths', () => {
    const result = checkProtectedPath('/tmp/repo/.git/objects/pack/pack-abc123.idx')
    expect(result).not.toBeNull()
    expect(result?.level).toBe('hard')
    expect(result?.rule).toBe('git-objects')
  })
})

describe('isHardBlocked', () => {
  it('returns true for ~/.ssh', () => {
    expect(isHardBlocked(path.join(HOME, '.ssh', 'config'))).toBe(true)
  })

  it('returns false for an ordinary path', () => {
    expect(isHardBlocked('/tmp/ordinary/file.ts')).toBe(false)
  })

  it('returns false for a soft-blocked path', () => {
    // soft rules are not hard-blocked
    expect(isHardBlocked(path.join(HOME, '.zshrc'))).toBe(false)
  })
})

describe('filterBlockedPaths', () => {
  it('separates hard-blocked paths from allowed paths', () => {
    const paths = [
      '/tmp/project/src/app.ts',
      path.join(HOME, '.ssh', 'id_rsa'),
      '/tmp/project/src/index.ts',
      path.join(HOME, '.gnupg', 'secring.gpg'),
    ]
    const { allowed, blocked } = filterBlockedPaths(paths)
    expect(allowed).toEqual(['/tmp/project/src/app.ts', '/tmp/project/src/index.ts'])
    expect(blocked).toHaveLength(2)
    expect(blocked[0].violation.level).toBe('hard')
  })

  it('allows all paths when none are protected', () => {
    const paths = ['/tmp/a.ts', '/tmp/b.ts']
    const { allowed, blocked } = filterBlockedPaths(paths)
    expect(allowed).toEqual(paths)
    expect(blocked).toHaveLength(0)
  })
})
