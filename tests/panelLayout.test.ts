import { describe, expect, it } from 'vitest'
import { DEFAULT_GIT_PANEL_SIDE, parseGitPanelSide } from '../src/lib/panelLayout'

/** Only the git panel can move; the persisted value decides which side it opens on. */
describe('parseGitPanelSide', () => {
  it('reads back the left side', () => {
    expect(parseGitPanelSide('left')).toBe('left')
  })

  it('reads back the right side', () => {
    expect(parseGitPanelSide('right')).toBe('right')
  })

  it('falls back to the default for anything else', () => {
    expect(DEFAULT_GIT_PANEL_SIDE).toBe('right')
    expect(parseGitPanelSide(null)).toBe('right')
    expect(parseGitPanelSide('')).toBe('right')
    expect(parseGitPanelSide('LEFT')).toBe('right')
    expect(parseGitPanelSide('top')).toBe('right')
  })
})
