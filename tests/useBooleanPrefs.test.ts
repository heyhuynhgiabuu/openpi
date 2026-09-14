import { createRoot } from 'solid-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useBooleanPrefs } from '../src/components/customizations/useBooleanPrefs'
import { POLICY_PREFERENCES, DEFAULT_POLICY_PREFERENCES } from '../src/lib/policyPreferences'

function stubPrefs(options: { fail?: boolean } = {}) {
  const writes: Array<[string, string]> = []
  vi.stubGlobal('openpi', {
    setPref: (key: string, value: string) => {
      writes.push([key, value])
      return options.fail ? Promise.reject(new Error('disk full')) : Promise.resolve()
    },
  })
  return writes
}

function setup(options: { load?: boolean; fail?: boolean } = {}) {
  const writes = stubPrefs(options)
  const markSaved = vi.fn()
  const onError = vi.fn()
  const onChange = vi.fn()

  const root = createRoot((dispose) => {
    const prefs = useBooleanPrefs({
      metas: POLICY_PREFERENCES,
      defaults: DEFAULT_POLICY_PREFERENCES,
      load: async () => ({ preApplyReview: options.load ?? false }),
      markSaved,
      onError,
      onChange,
    })
    return { prefs, dispose }
  })

  return { ...root, writes, markSaved, onError, onChange }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useBooleanPrefs', () => {
  it('starts at the defaults', () => {
    const { prefs, dispose } = setup()
    expect(prefs.values()).toEqual({ preApplyReview: false })
    dispose()
  })

  it('stores a change under the preference key and marks it saved', async () => {
    const { prefs, writes, markSaved, onChange, dispose } = setup()

    prefs.save('preApplyReview', true)

    expect(prefs.values()).toEqual({ preApplyReview: true })
    expect(onChange).toHaveBeenCalledWith({ preApplyReview: true })
    await vi.waitFor(() => expect(writes).toEqual([['policy.pre_apply_review', 'true']]))
    await vi.waitFor(() => expect(markSaved).toHaveBeenCalledWith('preApplyReview'))
    dispose()
  })

  it('resets to the default value', async () => {
    const { prefs, writes, dispose } = setup()

    prefs.save('preApplyReview', true)
    prefs.reset('preApplyReview')

    expect(prefs.values()).toEqual({ preApplyReview: false })
    await vi.waitFor(() => expect(writes.at(-1)).toEqual(['policy.pre_apply_review', 'false']))
    dispose()
  })

  it('applies loaded values', async () => {
    const { prefs, dispose } = setup({ load: true })

    await prefs.load()

    expect(prefs.values()).toEqual({ preApplyReview: true })
    dispose()
  })

  it('reports a failed write without changing what was stored', async () => {
    const { prefs, onError, markSaved, dispose } = setup({ fail: true })

    prefs.save('preApplyReview', true)

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('disk full'))
    expect(markSaved).not.toHaveBeenCalled()
    dispose()
  })
})
