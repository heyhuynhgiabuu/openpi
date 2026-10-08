import { describe, expect, it } from 'vitest'
import {
  applySettingValue,
  type ChoiceField,
  choiceIndex,
  getNestedValue,
} from '../src/components/customizations/settingsHelpers'
import { SECTIONS } from '../src/components/customizations/settingsSections'

/**
 * Pi 1.0.1 stores quietStartup as `boolean | "header"` (docs/settings.md).
 * Pi's TUI reads anything other than `true` or `"header"` as `false`.
 */
function quietStartupField(): ChoiceField {
  const field = SECTIONS.flatMap((section) => section.fields).find(
    (candidate) => candidate.key === 'quietStartup'
  )
  if (!field || field.type !== 'choice') throw new Error('quietStartup must be a choice field')
  return field
}

describe('quietStartup setting', () => {
  it('offers false, "header", and true in Pi order with false as the default', () => {
    const field = quietStartupField()
    expect(field.options.map((option) => option.value)).toEqual([false, 'header', true])
    expect(field.default).toBe(false)
  })

  it('gives every option a TUI label and help text', () => {
    for (const option of quietStartupField().options) {
      expect(option.label.trim()).not.toBe('')
      expect(option.help.trim()).not.toBe('')
    }
  })

  it('maps each persisted value back to its option and falls back for unknown values', () => {
    const { options } = quietStartupField()
    expect(choiceIndex(options, false)).toBe(0)
    expect(choiceIndex(options, 'header')).toBe(1)
    expect(choiceIndex(options, true)).toBe(2)
    expect(choiceIndex(options, undefined)).toBe(-1)
    expect(choiceIndex(options, 'yes')).toBe(-1)
  })

  it('writes each option back with its persisted type and reads it again', () => {
    const { options } = quietStartupField()
    for (const option of options) {
      const saved = applySettingValue({}, 'quietStartup', option.value)
      // toEqual distinguishes boolean false/true from the strings 'false'/'true'.
      expect(saved).toEqual({ quietStartup: option.value })
      expect(choiceIndex(options, getNestedValue(saved, 'quietStartup'))).toBe(
        choiceIndex(options, option.value)
      )
    }
  })

  it('keeps an explicit false instead of deleting the key', () => {
    expect(applySettingValue({ quietStartup: true }, 'quietStartup', false)).toEqual({
      quietStartup: false,
    })
    expect(applySettingValue({ quietStartup: 'header' }, 'quietStartup', true)).toEqual({
      quietStartup: true,
    })
  })
})
