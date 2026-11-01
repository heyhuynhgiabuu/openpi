import { describe, expect, it } from 'vitest'
import {
  fulfillExtensionUiPending,
  registerExtensionUiPending,
} from '../electron/pi/extensionUiPending'

describe('extensionUiPending', () => {
  it('resolves when fulfilled', async () => {
    const p = new Promise<{ id: string; confirmed?: boolean }>((resolve, reject) => {
      registerExtensionUiPending('a1', 5000, resolve, reject)
    })
    expect(fulfillExtensionUiPending({ id: 'a1', confirmed: true })).toBe(true)
    await expect(p).resolves.toEqual({ id: 'a1', confirmed: true })
  })

  it('settles as cancelled when the prompt expires, which callers read as a denial', async () => {
    // The durable pre-apply review relies on this: a prompt nobody answers must never hang the
    // tool call, and must never be mistaken for approval.
    const p = new Promise<{ id: string; cancelled?: boolean }>((resolve, reject) => {
      registerExtensionUiPending('a2', 1, resolve, reject)
    })
    await expect(p).resolves.toEqual({ id: 'a2', cancelled: true })
  })

  it('returns false for unknown id', () => {
    expect(fulfillExtensionUiPending({ id: 'missing', confirmed: true })).toBe(false)
  })
})
