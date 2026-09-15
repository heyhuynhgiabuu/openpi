import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyThemeTokens,
  isThemeApplied,
  resetTheme,
  restoreThemeFromStorage,
} from '../src/lib/themeApply'
import { resetThemeDocument, stubBrowserComputedStyle } from './helpers/themeFixture'

const STORAGE_KEY = 'openpi-active-theme-vars'

/** A three-token palette: enough to fill the canvas vars and nothing else. */
const sparse = {
  vars: { crust: '#11111b', base: '#1e1e2e', text: '#cdd6f4' },
  colors: { accent: '#cba6f7' },
}

const root = () => document.documentElement.style
const read = (name: string) => root().getPropertyValue(name)
const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')

/** The six shiki vars the stylesheet palette resolves to when a theme omits them. */
const sheetShiki = {
  '--shiki-color-background': '#1b1a19',
  '--shiki-color-text': '#f7f3ee',
  '--shiki-token-keyword': '#3b82f6',
  '--shiki-token-comment': '#68625d',
  '--shiki-token-parameter': '#b9b1aa',
  '--shiki-token-punctuation': '#817a73',
}

describe('persisting an applied theme', () => {
  beforeEach(() => {
    resetThemeDocument()
    stubBrowserComputedStyle()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('stores only the vars this palette could fill', () => {
    applyThemeTokens(sparse)

    // `--hairline`, `--ink-soft`, `--graphite`, `--mute` and `--stone` have no
    // source in this palette. The shiki vars read from those five and from
    // `--ink`, so they fall back to the stylesheet palette a browser resolves.
    expect(stored()).toEqual({
      '--canvas': '#11111b',
      '--canvas-warm': '#11111b',
      '--scrim': '#11111b',
      '--footer': '#11111b',
      '--surface-soft': '#1e1e2e',
      '--surface-inset': '#11111b',
      '--ink': '#cdd6f4',
      '--accent': '#cba6f7',
      '--shiki-color-background': '#1e1e2e',
      '--shiki-color-text': '#cdd6f4',
      '--shiki-token-keyword': '#cba6f7',
      '--shiki-token-comment': '#68625d',
      '--shiki-token-parameter': '#b9b1aa',
      '--shiki-token-punctuation': '#817a73',
    })
  })

  it('clears what the previous theme left when the next one omits a token', () => {
    applyThemeTokens({
      vars: { crust: '#11111b', surface0: '#313244' },
      colors: { accent: '#cba6f7' },
    })
    expect(read('--accent')).toBe('#cba6f7')
    expect(read('--surface-card')).toBe('#313244')

    applyThemeTokens({ vars: { crust: '#000000' }, colors: {} })

    expect(read('--canvas')).toBe('#000000')
    expect(read('--accent')).toBe('')
    expect(read('--surface-card')).toBe('')
    expect(read('--shiki-token-keyword')).toBe('#3b82f6')
    expect(stored()).toEqual({
      '--canvas': '#000000',
      '--canvas-warm': '#000000',
      '--scrim': '#000000',
      '--footer': '#000000',
      '--surface-inset': '#000000',
      ...sheetShiki,
    })
  })

  it('leaves unrelated inline styles alone', () => {
    root().setProperty('--font-ui', 'Inter')
    applyThemeTokens(sparse)

    expect(read('--font-ui')).toBe('Inter')
  })
})

describe('isThemeApplied', () => {
  beforeEach(() => {
    resetThemeDocument()
    stubBrowserComputedStyle()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is false before any theme has been applied', () => {
    expect(isThemeApplied()).toBe(false)
  })

  it('is true after applying a theme', () => {
    applyThemeTokens(sparse)

    expect(isThemeApplied()).toBe(true)
  })

  it('is false for a snapshot that carries no vars', () => {
    localStorage.setItem(STORAGE_KEY, '{}')

    expect(isThemeApplied()).toBe(false)
  })

  it('is false for a snapshot of keys this module does not own', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ '--not-ours': '#fff', another: 'x' }))

    expect(isThemeApplied()).toBe(false)
  })

  it('is false for an owned key whose value is empty or whitespace', () => {
    for (const value of ['', '   ']) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ '--canvas': value }))
      expect(isThemeApplied()).toBe(false)
    }
  })

  it('is true when at least one owned key carries a value', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ '--canvas': '#111111', '--ink': '' }))

    expect(isThemeApplied()).toBe(true)
  })

  it('is false for a stored value that is not a string map', () => {
    for (const raw of ['garbage', 'null', '5', '{"--canvas":5}', '{"--canvas":{"a":1}}']) {
      localStorage.setItem(STORAGE_KEY, raw)
      expect(isThemeApplied()).toBe(false)
    }
  })

  it('reports true for a palette whose tokens it cannot map', () => {
    applyThemeTokens({ vars: { unknownKey: '#123456' }, colors: {} })

    // Nothing from the theme lands, but the shiki vars are mirrored from the
    // stylesheet palette, so a snapshot exists. Whether that should count as
    // "custom theme applied" is a product question, tracked in STATUS.md.
    expect(stored()).toEqual(sheetShiki)
    expect(isThemeApplied()).toBe(true)
  })
})

describe('resetTheme', () => {
  beforeEach(() => {
    resetThemeDocument()
    stubBrowserComputedStyle()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('removes the vars and the stored snapshot', () => {
    applyThemeTokens(sparse)
    expect(isThemeApplied()).toBe(true)

    resetTheme()

    expect(read('--canvas')).toBe('')
    expect(read('--ink')).toBe('')
    expect(read('--accent')).toBe('')
    expect(read('--shiki-token-keyword')).toBe('')
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(isThemeApplied()).toBe(false)
  })

  it('leaves unrelated inline styles alone', () => {
    root().setProperty('--app-zoom', '1.25')
    applyThemeTokens(sparse)

    resetTheme()

    expect(read('--app-zoom')).toBe('1.25')
  })
})

describe('restoreThemeFromStorage', () => {
  beforeEach(() => {
    resetThemeDocument()
    stubBrowserComputedStyle()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reapplies a stored snapshot', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ '--canvas': '#111111', '--ink': '#eeeeee' }))

    restoreThemeFromStorage()

    expect(read('--canvas')).toBe('#111111')
    expect(read('--ink')).toBe('#eeeeee')
  })

  it('round-trips a theme through reset and restore', () => {
    applyThemeTokens(sparse)
    const snapshot = localStorage.getItem(STORAGE_KEY)

    resetTheme()
    expect(read('--canvas')).toBe('')

    localStorage.setItem(STORAGE_KEY, snapshot ?? '')
    restoreThemeFromStorage()

    expect(read('--canvas')).toBe('#11111b')
    expect(read('--shiki-token-keyword')).toBe('#cba6f7')
  })

  it('does nothing when there is no snapshot', () => {
    restoreThemeFromStorage()

    expect(read('--canvas')).toBe('')
  })

  it('drops a snapshot it cannot parse', () => {
    localStorage.setItem(STORAGE_KEY, 'not json')

    restoreThemeFromStorage()

    expect(read('--canvas')).toBe('')
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('drops a snapshot whose values are not strings', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ '--canvas': 5, '--ink': { a: 1 } }))

    restoreThemeFromStorage()

    expect(read('--canvas')).toBe('')
    expect(read('--ink')).toBe('')
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('skips keys this module does not own but keeps the rest', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ '--canvas': '#111111', '--evil': 'url(x)' }))

    restoreThemeFromStorage()

    expect(read('--canvas')).toBe('#111111')
    expect(read('--evil')).toBe('')
  })

  it('treats an empty or whitespace value as no value and clears the var', () => {
    for (const value of ['', '   ']) {
      resetThemeDocument()
      root().setProperty('--canvas', '#999999')
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ '--canvas': value, '--ink': '#eeeeee' }))

      restoreThemeFromStorage()

      expect(read('--canvas')).toBe('')
      expect(read('--ink')).toBe('#eeeeee')
    }
  })
})
