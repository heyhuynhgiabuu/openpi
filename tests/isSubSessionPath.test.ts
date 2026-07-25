import { describe, expect, it } from 'vitest'
import { isSubSessionPath } from '../src/lib/subSessionNavigation'

describe('isSubSessionPath', () => {
  it('returns true for paths under the current pi-task session directory', () => {
    expect(
      isSubSessionPath(
        '/Users/me/proj/.pi/artifacts/tasks/sessions/mqzbadgj-3a1e/2026-06-29T14-27-08-162Z_019f13c6.jsonl'
      )
    ).toBe(true)
  })

  it('returns false for the main workspace session dir', () => {
    expect(
      isSubSessionPath('/Users/me/.pi/agent/sessions/2026-06-29T14-00-00-000Z_abc.jsonl')
    ).toBe(false)
  })

  it('returns false for any other path', () => {
    expect(isSubSessionPath('/some/other/path/session.jsonl')).toBe(false)
    expect(isSubSessionPath('')).toBe(false)
    expect(isSubSessionPath(null)).toBe(false)
    expect(isSubSessionPath(undefined)).toBe(false)
  })

  it('uses the canonical .pi/artifacts/sessions/ marker exactly', () => {
    // Without the trailing /sessions/ it is not a sub-session.
    expect(isSubSessionPath('/proj/.pi/artifacts/something/x.jsonl')).toBe(false)
  })
})
