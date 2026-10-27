import { describe, expect, it } from 'vitest'
import { SECTIONS } from '../src/components/customizations/settingsSections'

/**
 * Pi 1.4.0: `compaction.reserveTokens` only decides when compaction starts
 * (`contextTokens > contextWindow - reserveTokens`); summaries use the model's
 * output limit (docs/compaction.md).
 */
function reserveTokensField() {
  const field = SECTIONS.flatMap((section) => section.fields).find(
    (candidate) => candidate.key === 'compaction.reserveTokens'
  )
  if (!field) throw new Error('compaction.reserveTokens setting is missing')
  return field
}

describe('compaction.reserveTokens setting copy', () => {
  it('describes it as the compaction trigger, not as a summary-response reserve', () => {
    const { description } = reserveTokensField()
    expect(description).toMatch(/auto-compaction starts/i)
    expect(description).not.toMatch(/reserved for the llm response/i)
    expect(description).toMatch(/does not limit summary length/i)
  })

  it('keeps the persisted key and Pi default unchanged', () => {
    const field = reserveTokensField()
    expect(field.type).toBe('number')
    expect(field.default).toBe(16384)
  })
})
