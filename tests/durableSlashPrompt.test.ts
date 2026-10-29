import { describe, expect, it } from 'vitest'
import { promptText } from '../electron/pi/durablePrompt'

/**
 * `/`-prefixed prompts reach the harness, which expands a known template before the model sees it.
 * Refusing them here would drop what the user typed: the composer clears its input on send.
 */

describe('a slash prompt on the durable runtime', () => {
  it('is passed through so the harness can expand it', () => {
    expect(promptText({ text: '/review the diff' })).toBe('/review the diff')
  })

  it('keeps the context prefix in front of it', () => {
    expect(promptText({ text: '/review', contextPrefix: 'context' })).toBe('context\n\n/review')
  })
})
