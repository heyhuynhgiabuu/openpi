import { describe, expect, it } from 'vitest'
import {
  buildFileContextBlocks,
  buildSkillContextBlocks,
  stripSkillFrontmatter,
} from '../src/lib/promptContext'
import type { SkillItem } from '../src/lib/ipc'

/**
 * These blocks are the prompt text the model receives for an attached skill or
 * file, and the frontmatter rules mirror Pi's own `stripFrontmatter` — the same
 * SKILL.md has to reach the model the same way whether it was attached here or
 * expanded from a `/skill:` command.
 */

function skill(overrides: Partial<SkillItem> = {}): SkillItem {
  return {
    name: 'pdf-tools',
    description: 'Work with PDFs',
    path: '/home/me/.pi/agent/skills/pdf-tools',
    scope: 'user',
    tags: [],
    ...overrides,
  }
}

describe('stripSkillFrontmatter', () => {
  it('drops a frontmatter block and the blank line after it', () => {
    expect(stripSkillFrontmatter('---\nname: x\n---\nbody\n')).toBe('body')
  })

  it('strips a byte order mark before looking for the block', () => {
    expect(stripSkillFrontmatter('\uFEFF---\nname: x\n---\nbody\n')).toBe('body')
  })

  it('normalizes CRLF line endings', () => {
    expect(stripSkillFrontmatter('---\r\nname: x\r\n---\r\nbody line\r\n')).toBe('body line')
    // A blank line inside the body must stay one blank line: replacing `\r` alone
    // would double it.
    expect(stripSkillFrontmatter('---\nname: x\n---\nfirst\r\n\r\nsecond\r\n')).toBe(
      'first\n\nsecond'
    )
  })

  it('returns content without frontmatter unchanged', () => {
    expect(stripSkillFrontmatter('just a body\n')).toBe('just a body\n')
  })

  it('keeps everything when the block is never closed', () => {
    expect(stripSkillFrontmatter('---\nname: x\nbody\n')).toBe('---\nname: x\nbody\n')
  })

  it('returns an empty body when the block is empty', () => {
    expect(stripSkillFrontmatter('---\nname: x\n---\n')).toBe('')
  })

  it('only strips the first block, not a later rule', () => {
    expect(stripSkillFrontmatter('---\nname: x\n---\nbody\n---\nmore\n')).toBe('body\n---\nmore')
  })

  it('treats an indented rule as body text, like Pi does', () => {
    // Pi checks the raw content, so leading spaces mean "no frontmatter" rather
    // than "strip it".
    expect(stripSkillFrontmatter('   ---\nname: x\n---\nbody\n')).toBe(
      '   ---\nname: x\n---\nbody\n'
    )
  })
})

describe('buildSkillContextBlocks', () => {
  it('wraps a skill body in the same block Pi expands', () => {
    expect(
      buildSkillContextBlocks([skill()], ['---\nname: pdf-tools\n---\nDo the thing.\n'])
    ).toEqual([
      '<skill name="pdf-tools" location="/home/me/.pi/agent/skills/pdf-tools/SKILL.md">\n' +
        'References are relative to /home/me/.pi/agent/skills/pdf-tools.\n\n' +
        'Do the thing.\n</skill>',
    ])
  })

  it('skips a skill whose file could not be read', () => {
    expect(buildSkillContextBlocks([skill(), skill({ name: 'other' })], [null, 'body'])).toEqual([
      '<skill name="other" location="/home/me/.pi/agent/skills/pdf-tools/SKILL.md">\n' +
        'References are relative to /home/me/.pi/agent/skills/pdf-tools.\n\n' +
        'body\n</skill>',
    ])
  })

  it('keeps each body paired with its own skill', () => {
    const skills = [
      skill({ name: 'first', path: '/skills/first' }),
      skill({ name: 'second', path: '/skills/second' }),
    ]
    const blocks = buildSkillContextBlocks(skills, ['one', 'two'])
    expect(blocks[0]).toContain('name="first"')
    expect(blocks[0]).toContain('one\n</skill>')
    expect(blocks[1]).toContain('name="second"')
    expect(blocks[1]).toContain('two\n</skill>')
  })

  it('trims a body that has no frontmatter, like Pi does', () => {
    expect(buildSkillContextBlocks([skill()], ['just a body\n'])).toEqual([
      '<skill name="pdf-tools" location="/home/me/.pi/agent/skills/pdf-tools/SKILL.md">\n' +
        'References are relative to /home/me/.pi/agent/skills/pdf-tools.\n\n' +
        'just a body\n</skill>',
    ])
  })

  it('ignores a body with no matching skill', () => {
    expect(buildSkillContextBlocks([], ['orphan'])).toEqual([])
  })
})

describe('buildFileContextBlocks', () => {
  it('wraps file contents with their path', () => {
    expect(buildFileContextBlocks(['src/App.tsx'], [{ content: 'const a = 1' }])).toEqual([
      '<file path="src/App.tsx">\nconst a = 1\n</file>',
    ])
  })

  it('skips a file that could not be read', () => {
    expect(buildFileContextBlocks(['a.ts', 'b.ts'], [null, { content: 'b' }])).toEqual([
      '<file path="b.ts">\nb\n</file>',
    ])
  })

  it('keeps each content paired with its own path', () => {
    const blocks = buildFileContextBlocks(['a.ts', 'b.ts'], [{ content: 'A' }, { content: 'B' }])
    expect(blocks).toEqual(['<file path="a.ts">\nA\n</file>', '<file path="b.ts">\nB\n</file>'])
  })

  it('ignores content with no matching path', () => {
    expect(buildFileContextBlocks([], [{ content: 'orphan' }])).toEqual([])
  })
})
