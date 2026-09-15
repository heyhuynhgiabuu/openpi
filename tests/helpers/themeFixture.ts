import { vi } from 'vitest'
import type { ThemeTokens } from '../../src/lib/ipc'

/**
 * The six palette entries the shiki mirroring reads, at their `src/index.css`
 * dark-scheme defaults. A browser resolves these from the stylesheet; jsdom
 * only resolves inline styles, so `stubBrowserComputedStyle` stands in for the
 * cascade and keeps the assertions shaped like the app's behaviour.
 */
export const INDEX_CSS_PALETTE = {
  '--surface-soft': '#1b1a19',
  '--ink': '#f7f3ee',
  '--stone': '#68625d',
  '--mute': '#817a73',
  '--graphite': '#b9b1aa',
  '--accent': '#3b82f6',
} satisfies Record<string, string>

/**
 * `getComputedStyle` as a browser answers it: an inline value wins, otherwise
 * the stylesheet default. Only the names these tests read are emulated.
 */
export function stubBrowserComputedStyle(): void {
  vi.stubGlobal('getComputedStyle', () => ({
    getPropertyValue: (name: string) => {
      const inline = document.documentElement.style.getPropertyValue(name).trim()
      const fallback = Object.entries(INDEX_CSS_PALETTE).find(([key]) => key === name)?.[1]
      return inline || fallback || ''
    },
  }))
}

/** Reset the document and storage between tests. */
export function resetThemeDocument(): void {
  document.documentElement.style.cssText = ''
  localStorage.clear()
}

/** `~/.pi/agent/themes/catppuccin.json`, resolved to hex the way the IPC handler does. */
export const catppuccin: ThemeTokens = {
  vars: {
    base: '#1e1e2e',
    mantle: '#181825',
    crust: '#11111b',
    surface0: '#313244',
    surface1: '#45475a',
    surface2: '#585b70',
    overlay0: '#6c7086',
    overlay1: '#7f849c',
    text: '#cdd6f4',
    subtext0: '#a6adc8',
    subtext1: '#bac2de',
  },
  colors: {
    accent: '#cba6f7',
    borderMuted: '#585b70',
    muted: '#585b70',
    text: '#cdd6f4',
    success: '#a6e3a1',
    warning: '#f9e2af',
    error: '#f38ba8',
  },
}

/** `~/.pi/agent/themes/tokyo-night.json`, resolved to hex the way the IPC handler does. */
export const tokyoNight: ThemeTokens = {
  vars: {
    bg: '#1a1b26',
    bgDark: '#16161e',
    fg: '#a9b1d6',
    comment: '#51597d',
    gray: '#363b54',
    dimGray: '#51597d',
    lightBlue: '#c0caf5',
    selectedBg: '#2a2f41',
  },
  colors: {
    accent: '#bb9af7',
    borderMuted: '#363b54',
    muted: '#51597d',
    success: '#73daca',
    warning: '#e0af68',
    error: '#db4b4b',
  },
}
