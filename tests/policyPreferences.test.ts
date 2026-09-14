import { describe, expect, it } from 'vitest'
import { isPreApplyReviewEnabled } from '../.pi/extensions/openpi-preapply-review/index'
import { sidecarPolicyEnv } from '../electron/pi/sidecarPolicyEnv'
import {
  DEFAULT_POLICY_PREFERENCES,
  POLICY_PREFERENCES,
  readPolicyPreferences,
} from '../src/lib/policyPreferences'

function prefs(entries: Record<string, string> = {}) {
  return (key: string) => entries[key] ?? null
}

describe('policy preferences', () => {
  it('keeps the default record in step with the preference metadata', () => {
    for (const meta of POLICY_PREFERENCES) {
      expect(DEFAULT_POLICY_PREFERENCES[meta.key]).toBe(meta.defaultValue)
    }
    expect(Object.keys(DEFAULT_POLICY_PREFERENCES)).toHaveLength(POLICY_PREFERENCES.length)
  })

  it('falls back to the default when nothing is stored', () => {
    expect(readPolicyPreferences(prefs())).toEqual({ preApplyReview: false })
  })

  it('reads the stored value', () => {
    expect(readPolicyPreferences(prefs({ 'policy.pre_apply_review': 'true' }))).toEqual({
      preApplyReview: true,
    })
    expect(readPolicyPreferences(prefs({ 'policy.pre_apply_review': 'false' }))).toEqual({
      preApplyReview: false,
    })
  })
})

describe('sidecar policy environment', () => {
  it('sets nothing while the policy is off', () => {
    expect(sidecarPolicyEnv({ preApplyReview: false })).toEqual({})
  })

  it('sets the variable the pre-apply gate reads', () => {
    const env = sidecarPolicyEnv({ preApplyReview: true })

    expect(env).toEqual({ OPENPI_PREAPPLY_REVIEW: '1' })
    // The extension decides with this exact environment, so a rename on either
    // side of the boundary fails here instead of silently disabling the gate.
    expect(isPreApplyReviewEnabled(env)).toBe(true)
    expect(isPreApplyReviewEnabled({})).toBe(false)
  })
})
