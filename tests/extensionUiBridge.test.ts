import { describe, expect, it, vi } from 'vitest'
import { emitExtensionNotify } from '../electron/pi/extensionUiBridge'

describe('extensionUiBridge', () => {
  it('emits custom message_start/end for conversation pane', () => {
    const sessionEvent = vi.fn()
    emitExtensionNotify(
      { sessionEvent, postExtensionUiRequest: () => {} },
      'info',
      'FFF v0.9.4\nGit: yes'
    )

    expect(sessionEvent).toHaveBeenCalledTimes(2)
    const start = sessionEvent.mock.calls[0]?.[0] as {
      type: string
      message: { role: string; details?: { level?: string } }
    }
    expect(start.type).toBe('message_start')
    expect(start.message.role).toBe('custom')
    expect(start.message.details?.level).toBe('info')
  })

  it('skips empty notify text', () => {
    const sessionEvent = vi.fn()
    emitExtensionNotify({ sessionEvent, postExtensionUiRequest: () => {} }, 'info', '   ')
    expect(sessionEvent).not.toHaveBeenCalled()
  })
})
