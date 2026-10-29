import { describe, expect, it } from 'vitest'
import { promptText } from '../electron/pi/durablePrompt'

/**
 * `/`-prefixed prompts reach the harness, which expands a known template before the model sees it.
 * An unanswered `/name` is reported, not thrown, and not sent as literal text — the SDK path reports
 * it the same way, and the composer has already cleared its input on send.
 */

describe('a slash prompt on the durable runtime', () => {
  it('sends the expanded body once the expander has answered it', () => {
    expect(promptText({ text: '/review the diff' }, () => 'REVIEW BODY the diff')).toEqual({
      text: 'REVIEW BODY the diff',
    })
  })

  it('reports a command nothing answers instead of sending it as text', () => {
    expect(promptText({ text: '/nope' })).toEqual({ text: '/nope', unknownCommand: '/nope' })
  })

  it('keeps quiet about steer and follow-up, as the SDK path does', () => {
    // `handleSteerCommand` passes unknown `/…` through; a steer like `/Users/me/x.ts is broken`
    // must not be refused on one runtime and sent on the other.
    expect(promptText({ text: '/Users/me/x.ts is broken' }, undefined, 'queue')).toEqual({
      text: '/Users/me/x.ts is broken',
    })
  })

  it('does not mistake a template body starting with / for an unanswered command', () => {
    // The check is on what the user typed, not on the expansion: `/ship` is answered, even though
    // its body happens to start with a slash.
    expect(promptText({ text: '/ship' }, () => '/deploy --prod')).toEqual({
      text: '/deploy --prod',
    })
  })

  it('expands before joining the context prefix', () => {
    // The expander only looks at the start of the text, so a prefix joined first would stop it.
    expect(promptText({ text: '/ship now', contextPrefix: 'ctx' }, () => 'Ship now.')).toEqual({
      text: 'ctx\n\nShip now.',
    })
  })
})
