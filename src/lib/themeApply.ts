/**
 * themeApply.ts
 *
 * Maps Pi theme JSON tokens → OpenPi CSS custom properties on <html>.
 * Persists the applied var map to localStorage so the theme survives restarts.
 *
 * Pi themes expose two layers:
 *   vars:   raw palette (hex),  e.g. { crust: '#11111b', base: '#1e1e2e', gray: '#363b54', ... }
 *   colors: semantic mappings (already resolved to hex by the IPC handler),
 *           e.g. { accent: '#cba6f7', success: '#a6e3a1', muted: '#6c7086', ... }
 *
 * Because different themes use different var naming conventions, we try a
 * priority-ordered list of candidate names for each OpenPi CSS var.
 */

import { z } from 'zod'
import type { ThemeTokens } from './ipc'

const STORAGE_KEY = 'openpi-active-theme-vars'

// All CSS custom properties we may set — used for full reset
const OPENPI_OWN_VARS = [
  '--canvas',
  '--canvas-warm',
  '--scrim',
  '--footer',
  '--surface-soft',
  '--surface-card',
  '--surface-raised',
  '--surface-inset',
  '--hairline',
  '--hairline-soft',
  '--hairline-strong',
  '--ink',
  '--ink-soft',
  '--graphite',
  '--mute',
  '--stone',
  '--ash',
  '--accent',
  '--success',
  '--warning',
  '--danger',
  '--error',
  // Shiki css-variables theme tokens (cleared on theme reset so :root defaults take over)
  '--shiki-color-background',
  '--shiki-color-text',
  '--shiki-token-keyword',
  '--shiki-token-string',
  '--shiki-token-string-expression',
  '--shiki-token-comment',
  '--shiki-token-function',
  '--shiki-token-constant',
  '--shiki-token-parameter',
  '--shiki-token-link',
  '--shiki-token-punctuation',
] as const

const OPENPI_OWN_VAR_SET: ReadonlySet<string> = new Set(OPENPI_OWN_VARS)

/** Shape written by `persistAppliedVars`; localStorage is outside our control. */
const storedVarsSchema = z.record(z.string())

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parse a stored snapshot, or return null when it is not a string map.
 * `JSON.parse` can yield `null`, a number or an object of objects; a raw cast
 * would hand any of those to `style.setProperty`.
 */
function readStoredVars(raw: string): Record<string, string> | null {
  try {
    const parsed = storedVarsSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** True when the snapshot carries at least one of our vars with a value. */
function hasAppliedVars(snapshot: Record<string, string>): boolean {
  return Object.entries(snapshot).some(([k, val]) => val.trim() !== '' && OPENPI_OWN_VAR_SET.has(k))
}

/** Return first non-empty value found in `vars` for any of the given keys. */
function tryVars(vars: Record<string, string>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    if (vars[k]) return vars[k]
  }
  return undefined
}

/** Set a CSS custom property on <html> only when value is defined. */
function set(cssVar: string, val: string | undefined | null): void {
  if (val) document.documentElement.style.setProperty(cssVar, val)
}

/** Remove every var this module owns, so index.css defaults take over again. */
function clearOwnVars(): void {
  const root = document.documentElement
  for (const v of OPENPI_OWN_VARS) root.style.removeProperty(v)
}

// ─── Core mapping ─────────────────────────────────────────────────────────────

/**
 * Map Pi theme tokens to OpenPi CSS vars and apply them to <html>.
 *
 * Priority order per var is derived by studying the two shipped Pi themes:
 *   Catppuccin Mocha: crust/mantle/base/surface0/surface1/surface2/overlay0/overlay1/text/subtext0/subtext1
 *   Tokyo Night:     bgDark/bg/gray/dimGray/fg/lightBlue/comment
 */
export function applyThemeTokens(tokens: ThemeTokens): void {
  const v = tokens.vars // palette, hex
  const c = tokens.colors // semantic, hex

  // Start from a clean slate: a theme that omits a token must fall back to the
  // index.css default, not keep the colour the previously applied theme left.
  clearOwnVars()

  // ── Background layers ─────────────────────────────────────────────────────
  // darkest                            Catppuccin  TN
  set('--canvas', tryVars(v, 'crust', 'bgDark', 'mantle'))
  set('--canvas-warm', tryVars(v, 'mantle', 'bgDark', 'crust'))
  // --scrim: main panel + composer bg. Use darkest layer same as canvas.
  set('--scrim', tryVars(v, 'crust', 'bgDark', 'mantle'))
  // --footer: very bottom bar. Use darkest layer.
  set('--footer', tryVars(v, 'crust', 'bgDark', 'mantle'))
  set('--surface-soft', tryVars(v, 'base', 'bg'))
  set('--surface-card', tryVars(v, 'surface0', 'gray', 'selectedBg'))
  set('--surface-raised', tryVars(v, 'surface1'))
  set('--surface-inset', tryVars(v, 'mantle', 'bgDark', 'crust'))

  // ── Borders ──────────────────────────────────────────────────────────────
  // borderMuted is the subtle separator in Pi; colors.border is usually accent-bright, avoid for hairlines
  set('--hairline', c.borderMuted ?? tryVars(v, 'surface0', 'gray'))
  set('--hairline-soft', tryVars(v, 'mantle', 'bgDark'))
  set('--hairline-strong', tryVars(v, 'surface2', 'overlay0', 'dimGray', 'gray'))

  // ── Text ──────────────────────────────────────────────────────────────────
  // colors['text'] may be empty string for some themes → fallback to vars
  set('--ink', c.text || tryVars(v, 'text', 'fg'))
  set('--ink-soft', tryVars(v, 'subtext1', 'lightBlue', 'fg'))
  set('--graphite', tryVars(v, 'subtext0', 'dimGray', 'fg'))
  set('--mute', c.muted || tryVars(v, 'overlay1', 'comment', 'dimGray'))
  set('--stone', tryVars(v, 'overlay0', 'comment', 'dimGray'))
  set('--ash', tryVars(v, 'surface2', 'overlay0', 'dimGray', 'gray'))

  // ── Semantic / accent ─────────────────────────────────────────────────────
  if (c.accent) set('--accent', c.accent)
  if (c.success) set('--success', c.success)
  if (c.warning) set('--warning', c.warning)
  if (c.error) {
    set('--danger', c.error)
    set('--error', c.error)
  }

  // ── Shiki token colours ──────────────────────────────────────────────────
  // Re-read computed values AFTER all palette vars have been written above,
  // then mirror them into the --shiki-* tokens used by the css-variables theme.
  // This keeps syntax highlighting in sync with whatever palette is active.
  const cs = getComputedStyle(document.documentElement)
  const _surface = cs.getPropertyValue('--surface-soft').trim()
  const _ink = cs.getPropertyValue('--ink').trim()
  const _stone = cs.getPropertyValue('--stone').trim()
  const _mute = cs.getPropertyValue('--mute').trim()
  const _graphite = cs.getPropertyValue('--graphite').trim()
  const _accent = cs.getPropertyValue('--accent').trim()
  if (_surface) set('--shiki-color-background', _surface)
  if (_ink) set('--shiki-color-text', _ink)
  if (_stone) set('--shiki-token-comment', _stone)
  if (_mute) set('--shiki-token-punctuation', _mute)
  if (_graphite) set('--shiki-token-parameter', _graphite)
  if (_accent) set('--shiki-token-keyword', _accent)

  // Persist for restore on next launch
  persistAppliedVars()
}

/** Remove all OpenPi CSS vars we may have set → reverts to index.css defaults. */
export function resetTheme(): void {
  clearOwnVars()
  localStorage.removeItem(STORAGE_KEY)
}

/** Save current inline style vars to localStorage. */
function persistAppliedVars(): void {
  const root = document.documentElement
  const snapshot: Record<string, string> = {}
  for (const v of OPENPI_OWN_VARS) {
    const val = root.style.getPropertyValue(v).trim()
    if (val) snapshot[v] = val
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
}

/** Restore theme vars from localStorage on app start (call once in App.tsx). */
export function restoreThemeFromStorage(): void {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return
  const snapshot = readStoredVars(raw)
  if (!snapshot) {
    localStorage.removeItem(STORAGE_KEY)
    return
  }
  const root = document.documentElement
  for (const [k, val] of Object.entries(snapshot)) {
    if (!OPENPI_OWN_VAR_SET.has(k)) continue
    // An empty or whitespace-only entry means "no value for this var", so drop
    // it rather than leaving whatever the document already had. Writing
    // whitespace would win the cascade and shadow the index.css default.
    const trimmed = val.trim()
    if (trimmed) root.style.setProperty(k, trimmed)
    else root.style.removeProperty(k)
  }
}

/**
 * True if any theme vars are currently applied (i.e. theme is active).
 * A stored snapshot that parsed to nothing usable — `{}`, only unknown keys,
 * or a value that is not a string map — does not count as an applied theme.
 */
export function isThemeApplied(): boolean {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return false
  const snapshot = readStoredVars(raw)
  return snapshot !== null && hasAppliedVars(snapshot)
}
