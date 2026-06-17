import { describe, expect, it } from 'vitest'
import { applySessionEvent } from '../src/lib/sessionEvents'

describe('extension notify via custom messages', () => {
  it('surfaces Pi custom role messages in the conversation', () => {
    const after = applySessionEvent([], {
      type: 'message_start',
      message: {
        role: 'custom',
        customType: 'openpi-extension-notify',
        content: 'FFF v0.9.4\nGit: yes',
        display: true,
        timestamp: 1_700_000_000_000,
      },
    })
    expect(after).toHaveLength(1)
    expect(after[0]?.role).toBe('extension')
    if (after[0]?.role === 'extension') {
      expect(after[0].text).toBe('FFF v0.9.4\nGit: yes')
      expect(after[0].commandName).toBe('')
    }
  })

  it('skips custom messages with display false', () => {
    const after = applySessionEvent([], {
      type: 'message_start',
      message: {
        role: 'custom',
        customType: 'hidden',
        content: 'secret',
        display: false,
        timestamp: 1,
      },
    })
    expect(after).toHaveLength(0)
  })
})
