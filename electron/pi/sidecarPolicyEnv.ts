import type { PolicyPreferences } from '../../src/lib/policyPreferences'

/**
 * App-level policy handed to the Pi sidecar through its environment, which is
 * how the pre-apply gate extension learns that the user enabled it.
 *
 * Read once at spawn: changing a policy preference applies to the next session,
 * not the running one. Each variable is listed in POLICY_PREFERENCES next to the
 * setting it mirrors, so the two cannot drift silently.
 */
export function sidecarPolicyEnv(prefs: PolicyPreferences): Record<string, string> {
  return prefs.preApplyReview ? { OPENPI_PREAPPLY_REVIEW: '1' } : {}
}
