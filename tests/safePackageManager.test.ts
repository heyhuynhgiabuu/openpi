import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { enforceIgnoreScriptsEnv } from '../electron/pi/safePackageManager'

describe('enforceIgnoreScriptsEnv', () => {
  const original = { ...process.env }

  beforeEach(() => {
    delete process.env.NPM_CONFIG_IGNORE_SCRIPTS
    delete process.env.npm_config_ignore_scripts
    delete process.env.PNPM_CONFIG_IGNORE_SCRIPTS
  })

  afterEach(() => {
    // Restore only the keys we touched, leaving the rest of the env alone.
    for (const key of [
      'NPM_CONFIG_IGNORE_SCRIPTS',
      'npm_config_ignore_scripts',
      'PNPM_CONFIG_IGNORE_SCRIPTS',
    ] as const) {
      if (original[key] === undefined) delete process.env[key]
      else process.env[key] = original[key]
    }
  })

  it('sets all three env vars when called from a clean env', () => {
    enforceIgnoreScriptsEnv()
    expect(process.env.NPM_CONFIG_IGNORE_SCRIPTS).toBe('true')
    expect(process.env.npm_config_ignore_scripts).toBe('true')
    expect(process.env.PNPM_CONFIG_IGNORE_SCRIPTS).toBe('true')
  })

  it('preserves a truthy pre-existing value', () => {
    process.env.NPM_CONFIG_IGNORE_SCRIPTS = 'true'
    enforceIgnoreScriptsEnv()
    expect(process.env.NPM_CONFIG_IGNORE_SCRIPTS).toBe('true')
  })

  it('overrides a falsy pre-existing value', () => {
    process.env.NPM_CONFIG_IGNORE_SCRIPTS = 'false'
    enforceIgnoreScriptsEnv()
    expect(process.env.NPM_CONFIG_IGNORE_SCRIPTS).toBe('true')
  })
})
