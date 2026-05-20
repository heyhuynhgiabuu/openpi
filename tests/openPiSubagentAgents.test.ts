import { describe, expect, it } from 'vitest'
import { parseFrontmatter } from '../electron/openPiSubagentAgents'

describe('parseFrontmatter', () => {
  it('parses string values', () => {
    const result = parseFrontmatter('name: my-agent\ndescription: My custom agent\n')
    expect(result).toEqual({
      name: 'my-agent',
      description: 'My custom agent',
    })
  })

  it('parses boolean values', () => {
    const result = parseFrontmatter('isolated: true\ninherit_context: false\n')
    expect(result).toEqual({
      isolated: true,
      inherit_context: false,
    })
  })

  it('parses number values', () => {
    const result = parseFrontmatter('max_turns: 10\n')
    expect(result).toEqual({ max_turns: 10 })
  })

  it('parses inline list', () => {
    const result = parseFrontmatter('tools: [read, grep, find]\n')
    expect(result).toEqual({ tools: ['read', 'grep', 'find'] })
  })

  it('parses indented list items', () => {
    const result = parseFrontmatter(
      [
        'tools:',
        '  - read',
        '  - grep',
        '  - find',
        'model: anthropic/claude-sonnet-4-20250514',
      ].join('\n')
    )
    expect(result).toEqual({
      tools: ['read', 'grep', 'find'],
      model: 'anthropic/claude-sonnet-4-20250514',
    })
  })

  it('returns empty object for empty frontmatter', () => {
    expect(parseFrontmatter('')).toEqual({})
  })

  it('ignores lines without key: value syntax', () => {
    const result = parseFrontmatter(
      'description: test\n# this is a comment\ndisplay_name: My Agent\n'
    )
    expect(result).toEqual({
      description: 'test',
      display_name: 'My Agent',
    })
  })

  it('parses thinking level', () => {
    const result = parseFrontmatter('thinking: high\n')
    expect(result).toEqual({ thinking: 'high' })
  })

  it('handles multiple named fields', () => {
    const result = parseFrontmatter(
      [
        'display_name: Code Expert',
        'description: Expert code reviewer',
        'model: anthropic/claude-sonnet-4-20250514',
        'thinking: high',
        'max_turns: 25',
        'tools:',
        '  - read',
        '  - grep',
        '  - srcwalk_search',
        'isolated: true',
        'enabled: true',
      ].join('\n')
    )
    expect(result).toEqual({
      display_name: 'Code Expert',
      description: 'Expert code reviewer',
      model: 'anthropic/claude-sonnet-4-20250514',
      thinking: 'high',
      max_turns: 25,
      tools: ['read', 'grep', 'srcwalk_search'],
      isolated: true,
      enabled: true,
    })
  })
})
