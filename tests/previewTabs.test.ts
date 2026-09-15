import { describe, expect, it } from 'vitest'
import { diffPreviewPath, isDiffPreviewTab, makeDiffPreviewTab } from '../src/lib/previewTabs'

/**
 * The review surface is a preview tab like any other, but it has no file behind
 * it, so its tab id is a scheme of its own and it renders as "Review".
 */
describe('diff preview tab', () => {
  it('identifies its own tab', () => {
    expect(isDiffPreviewTab(makeDiffPreviewTab())).toBe(true)
  })

  it('keeps the scheme other modules compare against', () => {
    // The tab id crosses component boundaries, so the literal is part of the
    // contract: renaming it silently breaks every comparison.
    expect(makeDiffPreviewTab()).toBe('openpi-diff://review')
  })

  it('does not claim a file path or an empty tab', () => {
    expect(isDiffPreviewTab('src/App.tsx')).toBe(false)
    expect(isDiffPreviewTab(undefined)).toBe(false)
    expect(isDiffPreviewTab('')).toBe(false)
    // Only the exact scheme counts.
    expect(isDiffPreviewTab('openpi-diff://review/other')).toBe(false)
  })

  it('labels the review tab and passes other tabs through', () => {
    expect(diffPreviewPath(makeDiffPreviewTab())).toBe('Review')
    expect(diffPreviewPath('src/App.tsx')).toBe('src/App.tsx')
  })
})
