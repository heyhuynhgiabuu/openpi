import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Tooltips have to name the keys the user actually has: the Mac glyphs are wrong
 * on Windows and Linux. The platform is read once at module load, so each case
 * imports the module fresh with the platform it needs.
 */

async function loadWithPlatform(platform: string) {
  vi.resetModules()
  vi.stubGlobal('navigator', { platform })
  return import('../src/lib/shortcutFormat')
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('formatShortcut', () => {
  it('uses the macOS form on a Mac', async () => {
    const { formatShortcut, isMacPlatform } = await loadWithPlatform('MacIntel')
    expect(isMacPlatform()).toBe(true)
    expect(formatShortcut('⌘N', 'Ctrl+N')).toBe('⌘N')
  })

  it('uses the other form elsewhere', async () => {
    const { formatShortcut, isMacPlatform } = await loadWithPlatform('Win32')
    expect(isMacPlatform()).toBe(false)
    expect(formatShortcut('⌘N', 'Ctrl+N')).toBe('Ctrl+N')
  })

  it('treats an iPad as a Mac', async () => {
    const { isMacPlatform } = await loadWithPlatform('iPad')
    expect(isMacPlatform()).toBe(true)
  })

  it('treats an empty platform as a non-Mac', async () => {
    const { isMacPlatform } = await loadWithPlatform('')
    expect(isMacPlatform()).toBe(false)
  })

  it('treats a Linux platform as a non-Mac', async () => {
    const { isMacPlatform } = await loadWithPlatform('Linux x86_64')
    expect(isMacPlatform()).toBe(false)
  })
})
