/**
 * safePackageManager.ts — Helpers for enforcing `--ignore-scripts` on
 * package installs initiated by the Pi SDK.
 *
 * Per Pi 0.75.4 supply-chain hardening: "Published npm installs now
 * include an `npm-shrinkwrap.json` to lock transitive dependencies for
 * the CLI package" and "Changed self-update package-manager commands to
 * disable lifecycle scripts during reinstall." This module aligns
 * OpenPi's package install/remove flow with that hardening.
 *
 * Why env-var injection instead of method wrapping: the SDK's
 * `DefaultPackageManager` keeps `runNpmCommand` private and exposes
 * only `install`, `installAndPersist`, `remove`, `removeAndPersist`,
 * `update`, etc. There is no public seam to inject extra CLI flags.
 * `npm` (and `pnpm`/`yarn`) honor `NPM_CONFIG_IGNORE_SCRIPTS=true` in
 * the parent process environment, which propagates to child npm
 * invocations. Setting it once on the sidecar process enforces the
 * policy for every subsequent package operation the SDK performs.
 */

/**
 * Augment `process.env` with the ignore-scripts flag so every npm/pnpm/yarn
 * invocation the sidecar spawns will skip lifecycle scripts.
 *
 * Idempotent: safe to call more than once.
 */
function ensureIgnoreScriptsVar(name: string): void {
  const value = process.env[name]
  // Treat any truthy value as already-enabled; only fill in when missing
  // or explicitly disabled. This preserves user overrides while enforcing
  // the policy by default.
  if (value === 'true' || value === '1' || value === 'yes') return
  process.env[name] = 'true'
}

export function enforceIgnoreScriptsEnv(): void {
  ensureIgnoreScriptsVar('NPM_CONFIG_IGNORE_SCRIPTS')
  ensureIgnoreScriptsVar('npm_config_ignore_scripts')
  // pnpm reads npm_config_* as well, but pin the canonical name too.
  ensureIgnoreScriptsVar('PNPM_CONFIG_IGNORE_SCRIPTS')
}
