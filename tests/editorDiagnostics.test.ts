import { describe, expect, it } from 'vitest'
import { diagnosticsEnabledFor } from '../src/components/editor/diagnostics'

describe('editor diagnostics', () => {
  it('enables diagnostics for JSON files', () => {
    expect(diagnosticsEnabledFor('settings.json')).toBe(true)
    expect(diagnosticsEnabledFor('tsconfig.JSON')).toBe(true)
  })

  it('keeps diagnostics disabled for files without a configured linter', () => {
    expect(diagnosticsEnabledFor('index.css')).toBe(false)
    expect(diagnosticsEnabledFor('App.tsx')).toBe(false)
    expect(diagnosticsEnabledFor('README.md')).toBe(false)
  })
})
