/**
 * Tunnel QR generation contract tests.
 *
 * Ensures the Electron-main QR encoder returns an inline PNG data URL for a
 * zrok tunnel URL, and rejects URLs it cannot encode.
 */

import { describe, expect, it } from 'vitest'
import { generateTunnelQr } from '../../electron/ipc/tunnel'

describe('generateTunnelQr', () => {
  it('returns a PNG data URL for a tunnel URL', async () => {
    const dataUrl = await generateTunnelQr('https://pi-dash-abc123.shares.zrok.io')
    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true)
    expect(dataUrl.length).toBeGreaterThan(64)
  })

  it('rejects an empty URL', async () => {
    await expect(generateTunnelQr('')).rejects.toThrow()
  })
})
