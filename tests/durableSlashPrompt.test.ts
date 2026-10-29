import { describe, expect, it } from 'vitest'
import { promptText } from '../electron/pi/durablePrompt'

/**
 * `/`-prefixed prompts reach the harness, which expands a known template before the model sees it.
 * Refusing them here would drop what the user typed: the composer clears its input on send.
 */

describe('a slash prompt on the durable runtime', () => {
  it('is passed through once the expander has answered it', () => {
    expect(promptText({ text: '/review the diff' }, () => 'REVIEW BODY the diff')).toBe(
      'REVIEW BODY the diff'
    )
  })

  it('refuses a command nothing answers, as the SDK path does', () => {
    expect(() => promptText({ text: '/nope' })).toThrow(/unknown command: \/nope/)
  })

  it('expands before joining the context prefix', () => {
    // The expander only looks at the start of the text, so a prefix joined first would stop it.
    expect(promptText({ text: '/ship now', contextPrefix: 'ctx' }, () => 'Ship now.')).toBe(
      'ctx\n\nShip now.'
    )
  })
})
