/**
 * Sidecar bootstrap: supply-chain hardening that must run before ANY other
 * sidecar module side effect (port check, bridge construction, SDK use).
 *
 * Align with Pi 0.75.4: skip lifecycle scripts on every npm/pnpm/yarn
 * invocation the SDK performs. Import this module FIRST everywhere; ES module
 * dependencies evaluate before the importing module's body, so placing this
 * import first guarantees the env is set before anything else runs.
 */
import { enforceIgnoreScriptsEnv } from './safePackageManager'

enforceIgnoreScriptsEnv()
