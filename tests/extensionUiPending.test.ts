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

  it('returns false for unknown id', () => {
    expect(fulfillExtensionUiPending({ id: 'missing', confirmed: true })).toBe(false)
  })
})
