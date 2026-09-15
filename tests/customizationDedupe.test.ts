import { describe, expect, it } from 'vitest'
import { dedupeItems } from '../electron/services/customizationHelpers'
import { makeItem } from './helpers/customizationFixture'

/**
 * `dedupeItems` folds the same resource found through several sources into one
 * row: the panel shows one entry per resource, enabled if any source enables it.
 */

describe('dedupeItems', () => {
  it('keeps one row per id and enables it if any source does', () => {
    const merged = dedupeItems([
      makeItem({ enabled: false, source: 'user-global' }),
      makeItem({ enabled: true, source: 'settings.json' }),
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0]?.enabled).toBe(true)
    expect(merged[0]?.source).toBe('user-global, settings.json')
  })

  it('labels the merged row as configured when any source came from settings', () => {
    const settingsFirst = dedupeItems([
      makeItem({ origin: 'settings', source: 'settings.json' }),
      makeItem({ origin: 'top-level', source: 'settings.json' }),
    ])
    expect(settingsFirst[0]?.origin).toBe('settings')
    expect(settingsFirst[0]?.source).toBe('settings.json')
    const settingsLast = dedupeItems([
      makeItem({ origin: 'top-level', source: 'settings.json' }),
      makeItem({ origin: 'settings', source: 'settings.json' }),
    ])
    expect(settingsLast[0]?.origin).toBe('settings')
    expect(settingsLast[0]?.source).toBe('settings.json')
  })

  it('enables the merged row whichever order the sources arrive in', () => {
    const enabledLast = dedupeItems([
      makeItem({ enabled: true, source: 'a' }),
      makeItem({ enabled: false, source: 'b' }),
    ])
    expect(enabledLast[0]?.enabled).toBe(true)
    const disabledLast = dedupeItems([
      makeItem({ enabled: false, source: 'a' }),
      makeItem({ enabled: true, source: 'b' }),
    ])
    expect(disabledLast[0]?.enabled).toBe(true)
  })

  it('sorts by scope even when the names disagree', () => {
    const merged = dedupeItems([
      makeItem({ id: 'skills:/z', type: 'skills', name: 'z', scope: 'project' }),
      makeItem({ id: 'skills:/a', type: 'skills', name: 'a', scope: 'user' }),
    ])
    expect(merged.map((entry) => entry.id)).toEqual(['skills:/z', 'skills:/a'])
  })

  it('sorts by name when type and scope are equal', () => {
    const merged = dedupeItems([
      makeItem({ id: 'skills:/b', type: 'skills', name: 'b' }),
      makeItem({ id: 'skills:/a', type: 'skills', name: 'a' }),
    ])
    expect(merged.map((entry) => entry.id)).toEqual(['skills:/a', 'skills:/b'])
  })

  it('sorts by type, then scope, then name', () => {
    const merged = dedupeItems([
      makeItem({ id: 'skills:/b', type: 'skills', name: 'b', scope: 'user' }),
      makeItem({ id: 'extensions:/z', type: 'extensions', name: 'z', scope: 'project' }),
      makeItem({ id: 'skills:/a', type: 'skills', name: 'a', scope: 'project' }),
      makeItem({ id: 'skills:/c', type: 'skills', name: 'c', scope: 'user' }),
    ])
    expect(merged.map((entry) => entry.id)).toEqual([
      'extensions:/z',
      'skills:/a',
      'skills:/b',
      'skills:/c',
    ])
  })

  it('leaves a single item untouched', () => {
    const one = makeItem()
    expect(dedupeItems([one])).toEqual([one])
  })
})
