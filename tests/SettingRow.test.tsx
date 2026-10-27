import { cleanup, fireEvent, render } from '@solidjs/testing-library'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SettingRow } from '../src/components/customizations/SettingRow'
import type { ChoiceField } from '../src/components/customizations/settingsHelpers'
import { SECTIONS } from '../src/components/customizations/settingsSections'

afterEach(cleanup)

function quietStartupField(): ChoiceField {
  const field = SECTIONS.flatMap((section) => section.fields).find(
    (candidate) => candidate.key === 'quietStartup'
  )
  if (!field || field.type !== 'choice') throw new Error('quietStartup must be a choice field')
  return field
}

function renderQuietStartup(value: boolean | string | undefined, onChange = vi.fn()) {
  const utils = render(() => (
    <SettingRow
      field={quietStartupField()}
      value={value}
      isExplicit={value !== undefined}
      scope="global"
      isLast={true}
      savedKey={null}
      onChange={onChange}
      onReset={() => {}}
    />
  ))
  // SAFETY: the ChoiceControl renders a native <select>, which carries the combobox role.
  const select = utils.getByRole('combobox') as HTMLSelectElement
  return { ...utils, select, onChange }
}

describe('SettingRow quietStartup', () => {
  it('shows the stored "header" value as its Pi TUI option', () => {
    const { select } = renderQuietStartup('header')
    expect(select.selectedOptions[0]?.textContent).toBe('Header only')
  })

  it('shows the stored true value as the quiet option', () => {
    const { select } = renderQuietStartup(true)
    expect(select.selectedOptions[0]?.textContent).toBe('Quiet')
  })

  it('falls back to the default option when nothing valid is stored', () => {
    const { select } = renderQuietStartup(undefined)
    expect(select.selectedOptions[0]?.textContent).toBe('Full startup')
  })

  it('writes the typed option value rather than its label', () => {
    const { select, onChange } = renderQuietStartup(false)
    const headerOption = [...select.options].find((option) => option.textContent === 'Header only')
    if (!headerOption) throw new Error('Missing "Header only" option')
    fireEvent.change(select, { target: { value: headerOption.value } })
    expect(onChange).toHaveBeenCalledWith('header')

    const quietOption = [...select.options].find((option) => option.textContent === 'Quiet')
    if (!quietOption) throw new Error('Missing "Quiet" option')
    fireEvent.change(select, { target: { value: quietOption.value } })
    expect(onChange).toHaveBeenLastCalledWith(true)
  })
})
