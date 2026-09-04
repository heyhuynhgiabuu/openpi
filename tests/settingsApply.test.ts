import { describe, expect, it } from 'vitest'
import { applySettingValue } from '../src/components/customizations/settingsHelpers'

describe('applySettingValue', () => {
  it('deletes the key when a string-array is emptied (defaultTools guard)', () => {
    const prev = { defaultTools: ['read', 'bash'] }
    expect(applySettingValue(prev, 'defaultTools', [])).toEqual({})
    // An absent defaultTools key means Pi defaults (read/bash/edit/write);
    // an explicit [] would disable every built-in tool.
  })

  it('keeps non-empty arrays as explicit values', () => {
    expect(applySettingValue({}, 'defaultTools', ['read', 'grep'])).toEqual({
      defaultTools: ['read', 'grep'],
    })
  })

  it('passes through scalar and nested-key writes', () => {
    expect(applySettingValue({}, 'compaction.enabled', false)).toEqual({
      compaction: { enabled: false },
    })
    expect(applySettingValue({ retry: { maxRetries: 3 } }, 'retry.maxRetries', 5)).toEqual({
      retry: { maxRetries: 5 },
    })
  })
})
