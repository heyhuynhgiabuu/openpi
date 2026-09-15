import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyThemeTokens } from '../src/lib/themeApply'
import {
  catppuccin,
  resetThemeDocument,
  stubBrowserComputedStyle,
  tokyoNight,
} from './helpers/themeFixture'

const root = () => document.documentElement.style
const read = (name: string) => root().getPropertyValue(name)

describe('applyThemeTokens with the catppuccin palette', () => {
  beforeEach(() => {
    resetThemeDocument()
    stubBrowserComputedStyle()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('maps the darkest palette layers to the shell surfaces', () => {
    applyThemeTokens(catppuccin)

    expect(read('--canvas')).toBe('#11111b')
    expect(read('--canvas-warm')).toBe('#181825')
    expect(read('--scrim')).toBe('#11111b')
    expect(read('--footer')).toBe('#11111b')
    expect(read('--surface-soft')).toBe('#1e1e2e')
    expect(read('--surface-card')).toBe('#313244')
    expect(read('--surface-raised')).toBe('#45475a')
    expect(read('--surface-inset')).toBe('#181825')
  })

  it('prefers the semantic border colour for hairlines', () => {
    applyThemeTokens(catppuccin)

    expect(read('--hairline')).toBe('#585b70')
    expect(read('--hairline-soft')).toBe('#181825')
    expect(read('--hairline-strong')).toBe('#585b70')
  })

  it('maps text layers from subtext down to the faintest grey', () => {
    applyThemeTokens(catppuccin)

    expect(read('--ink')).toBe('#cdd6f4')
    expect(read('--ink-soft')).toBe('#bac2de')
    expect(read('--graphite')).toBe('#a6adc8')
    expect(read('--mute')).toBe('#585b70')
    expect(read('--stone')).toBe('#6c7086')
    expect(read('--ash')).toBe('#585b70')
  })

  it('sets both danger and error from the semantic error colour', () => {
    applyThemeTokens(catppuccin)

    expect(read('--danger')).toBe('#f38ba8')
    expect(read('--error')).toBe('#f38ba8')
    expect(read('--accent')).toBe('#cba6f7')
    expect(read('--success')).toBe('#a6e3a1')
    expect(read('--warning')).toBe('#f9e2af')
  })

  it('falls back to palette vars when a semantic colour is missing', () => {
    // `''` and absent keys are what the IPC handler produces for unresolved
    // colours; neither may win over the palette.
    applyThemeTokens({
      vars: { text: '#c0caf5', overlay1: '#7f849c' },
      colors: { text: '', muted: '' },
    })

    expect(read('--ink')).toBe('#c0caf5')
    expect(read('--mute')).toBe('#7f849c')
  })

  it('leaves semantic vars unset when the theme omits them', () => {
    applyThemeTokens({ vars: { crust: '#11111b' }, colors: {} })

    expect(read('--accent')).toBe('')
    expect(read('--success')).toBe('')
    expect(read('--danger')).toBe('')
  })
})

describe('applyThemeTokens with the tokyo night palette', () => {
  beforeEach(() => {
    resetThemeDocument()
    stubBrowserComputedStyle()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('maps the same shell vars from the other naming convention', () => {
    applyThemeTokens(tokyoNight)

    expect(read('--canvas')).toBe('#16161e')
    expect(read('--canvas-warm')).toBe('#16161e')
    expect(read('--surface-soft')).toBe('#1a1b26')
    expect(read('--surface-card')).toBe('#363b54')
    expect(read('--hairline')).toBe('#363b54')
    expect(read('--hairline-strong')).toBe('#51597d')
    expect(read('--ink')).toBe('#a9b1d6')
    expect(read('--ink-soft')).toBe('#c0caf5')
    expect(read('--graphite')).toBe('#51597d')
    expect(read('--stone')).toBe('#51597d')
    // dimGray, not gray: this palette defines both.
    expect(read('--ash')).toBe('#51597d')
  })

  it('orders the grey fallbacks when a palette defines all of them', () => {
    // The shipped themes cannot show this: tokyo-night uses the same hex for
    // `comment` and `dimGray`, and catppuccin has neither.
    applyThemeTokens({
      vars: { comment: '#aaaaaa', dimGray: '#bbbbbb', gray: '#cccccc', surface2: '#dddddd' },
      colors: {},
    })

    expect(read('--stone')).toBe('#aaaaaa')
    expect(read('--graphite')).toBe('#bbbbbb')
    expect(read('--hairline-strong')).toBe('#dddddd')
    expect(read('--ash')).toBe('#dddddd')
  })

  it('leaves surface-raised unset because this palette has no equivalent', () => {
    applyThemeTokens(tokyoNight)

    expect(read('--surface-raised')).toBe('')
  })
})

describe('shiki token mirroring', () => {
  beforeEach(() => {
    resetThemeDocument()
    stubBrowserComputedStyle()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('mirrors the palette it just wrote into the shiki vars', () => {
    applyThemeTokens(catppuccin)

    expect(read('--shiki-color-background')).toBe('#1e1e2e')
    expect(read('--shiki-color-text')).toBe('#cdd6f4')
    expect(read('--shiki-token-comment')).toBe('#6c7086')
    expect(read('--shiki-token-punctuation')).toBe('#585b70')
    expect(read('--shiki-token-parameter')).toBe('#a6adc8')
    expect(read('--shiki-token-keyword')).toBe('#cba6f7')
  })

  it('mirrors the stylesheet default when the palette does not set that var', () => {
    applyThemeTokens({ vars: { crust: '#11111b' }, colors: {} })

    // A real browser resolves these from index.css; the seeded inline values
    // stand in for it here.
    expect(read('--shiki-color-background')).toBe('#1b1a19')
    expect(read('--shiki-color-text')).toBe('#f7f3ee')
    expect(read('--shiki-token-comment')).toBe('#68625d')
    expect(read('--shiki-token-punctuation')).toBe('#817a73')
    expect(read('--shiki-token-parameter')).toBe('#b9b1aa')
    expect(read('--shiki-token-keyword')).toBe('#3b82f6')
  })
})
