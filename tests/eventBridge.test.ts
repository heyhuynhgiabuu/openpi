import { describe, expect, it, vi } from 'vitest'

vi.mock('../electron/pi/sidecarContext', () => ({
  outputLine: vi.fn(),
  send: vi.fn(),
}))

const { isSessionIndexUpdateEvent } = await import('../electron/pi/eventBridge')

describe('Pi session index refresh events', () => {
  it('refreshes after agent completion and standalone entry appends', () => {
    expect(isSessionIndexUpdateEvent('agent_end')).toBe(true)
    expect(isSessionIndexUpdateEvent('entry_appended')).toBe(true)
  })

  it('ignores events that do not append persisted session state', () => {
    expect(isSessionIndexUpdateEvent('message_update')).toBe(false)
    expect(isSessionIndexUpdateEvent('compaction_start')).toBe(false)
  })
})
