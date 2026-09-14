/**
 * OpenPi policy preferences: optional rails around what the agent may do.
 *
 * These are OpenPi-owned (they configure OpenPi's own extension/host behaviour),
 * unlike the Pi settings in `settingsHost`, which Pi reads.
 */

export type PolicyPreferenceKey = 'preApplyReview'

export type PolicyPreferences = Record<PolicyPreferenceKey, boolean>

export interface PolicyPreferenceMeta {
  key: PolicyPreferenceKey
  storageKey: string
  label: string
  description: string
  defaultValue: boolean
}

export const POLICY_PREFERENCES: PolicyPreferenceMeta[] = [
  {
    key: 'preApplyReview',
    storageKey: 'policy.pre_apply_review',
    label: 'Review file edits before they apply',
    description:
      'Pi asks before it writes a file; inside OpenPi an edit opens a hunk review where you choose which parts to keep. Takes effect after OpenPi restarts.',
    defaultValue: false,
  },
]

/** Kept in step with POLICY_PREFERENCES by policyPreferences.test.ts. */
export const DEFAULT_POLICY_PREFERENCES: PolicyPreferences = {
  preApplyReview: false,
}

export const POLICY_PREFERENCES_CHANGED_EVENT = 'openpi:policy-preferences-changed'

function parsePref(raw: string | null, meta: PolicyPreferenceMeta): boolean {
  return raw == null || raw === '' ? meta.defaultValue : raw === 'true'
}

/** Renderer-side read; the async sibling of `readPolicyPreferences`. */
export async function loadPolicyPreferences(): Promise<PolicyPreferences> {
  const entries = await Promise.all(
    POLICY_PREFERENCES.map(async (pref) => {
      const raw = await window.openpi.getPref(pref.storageKey)
      return [pref.key, parsePref(raw, pref)] as const
    })
  )

  return entries.reduce(
    (acc, [key, value]) => {
      acc[key] = value
      return acc
    },
    { ...DEFAULT_POLICY_PREFERENCES }
  )
}

/**
 * Main-process read for callers that need the values before the renderer exists,
 * such as the environment the Pi sidecar is spawned with.
 */
export function readPolicyPreferences(getPref: (key: string) => string | null): PolicyPreferences {
  const entries = POLICY_PREFERENCES.map(
    (pref) => [pref.key, parsePref(getPref(pref.storageKey), pref)] as const
  )

  return entries.reduce(
    (acc, [key, value]) => {
      acc[key] = value
      return acc
    },
    { ...DEFAULT_POLICY_PREFERENCES }
  )
}
