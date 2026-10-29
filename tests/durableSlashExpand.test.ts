import { describe, expect, it } from 'vitest'
import type { DurableCustomizations } from '../electron/pi/durable/customizations'
import { expandInput } from '../electron/pi/durable/sections'
import { promptText } from '../electron/pi/durablePrompt'

/**
 * A `/`-prompt on the durable runtime: templates and `/skill:` invocations are expanded before the
 * context prefix is joined, because the expander only looks at the very start of the text.
 */

const found: DurableCustomizations = {
  skills: [
    {
      name: 'review',
      description: 'Review the diff',
      filePath: '/skills/review/SKILL.md',
      baseDir: '/skills/review',
      body: 'Look at the diff carefully.',
      slashOnly: true,
    },
  ],
  prompts: [
    {
      name: 'ship',
      description: '',
      argumentHint: '',
      filePath: '/p.md',
      body: 'Ship $ARGUMENTS now.',
    },
  ],
  diagnostics: [],
}

const expand = (text: string) => expandInput(text, found)

describe('expanding a slash prompt', () => {
  it('expands a prompt template with its arguments', () => {
    expect(expand('/ship the release')).toBe('Ship the release now.')
  })

  it('expands a slash-only skill, which the model is never offered', () => {
    const text = expand('/skill:review main..HEAD')
    expect(text).toContain('Look at the diff carefully.')
    expect(text).toContain('main..HEAD')
  })

  it('leaves an unknown command as typed, like the SDK path', () => {
    expect(expand('/nope')).toBe('/nope')
  })

  it('expands before joining the context prefix', () => {
    const text = promptText({ text: '/ship now', contextPrefix: 'ctx' }, expand)
    expect(text).toBe('ctx\n\nShip now now.')
  })
})
