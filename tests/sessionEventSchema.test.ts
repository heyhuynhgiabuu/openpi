import { describe, expect, it } from 'vitest'
import { sessionEventSchema } from '../src/lib/ipc'

/**
 * Pi adds new session event kinds over time (0.99 added `agent_before_settle`,
 * MCP connect events; later versions may add more). The sidecar forwards every
 * event verbatim, so the renderer schema must keep accepting kinds it does not
 * model yet — while still rejecting known kinds with malformed payloads.
 */
describe('sessionEventSchema forward compatibility', () => {
  it('accepts an unknown event kind through the extension bucket', () => {
    const parsed = sessionEventSchema.parse({
      type: 'agent_before_settle',
      isIdle: true,
      entries: [],
    })
    expect(parsed.type).toBe('agent_before_settle')
  })

  it('still rejects a known event kind with a malformed payload', () => {
    expect(() => sessionEventSchema.parse({ type: 'thinking_level_changed' })).toThrow()
  })
})
