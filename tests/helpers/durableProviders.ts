import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi } from 'vitest'
import type { ProviderConfig } from '@earendil-works/pi-coding-agent'

/** Fixtures shared by the durable provider tests: a global extension dir, and a fake registrar. */

/**
 * Temp dirs created here. Tests must clean up with `rmAll()`, because a leaked dir per test would
 * pollute the tmpdir for every later run.
 */
export const dirs: string[] = []

export async function rmAll(): Promise<void> {
  const { rm } = await import('node:fs/promises')
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
}

export const registeringExtension = `
export default function (pi) {
  pi.registerProvider('fixture-provider', {
    baseUrl: 'https://example.invalid/v1',
    apiKey: 'fixture-key',
    api: 'openai-completions',
    models: [{ id: 'fixture-model', name: 'Fixture' }],
  })
}
`

/** A global extension dir whose one extension registers a provider. */
export async function agentWithProvider(extensionSource: string): Promise<string> {
  const agentDir = await mkdtemp(join(tmpdir(), 'openpi-providers-'))
  dirs.push(agentDir)
  await mkdir(join(agentDir, 'extensions'), { recursive: true })
  await writeFile(join(agentDir, 'extensions', 'fixture.ts'), extensionSource)
  return agentDir
}

export function fakeRuntime() {
  const registered: Array<{ providerId: string; config: ProviderConfig }> = []
  const native: string[] = []
  return {
    registered,
    native,
    registerProvider: vi.fn((providerId: string, config: ProviderConfig) => {
      registered.push({ providerId, config })
    }),
    registerNativeProvider: vi.fn((provider: { id: string }) => {
      native.push(provider.id)
    }),
    refresh: vi.fn(async () => ({})),
    hasConfiguredAuth: vi.fn(() => true),
  }
}

/** A global settings.json that names an extension outside the extensions/ dir. */
export async function withSettingsExtension(agentDir: string, providerId: string): Promise<void> {
  await writeFile(join(agentDir, 'extra.ts'), registeringExtensionFor(providerId))
  await writeFile(
    join(agentDir, 'settings.json'),
    JSON.stringify({ extensions: [join(agentDir, 'extra.ts')] })
  )
}

export function registeringExtensionFor(providerId: string): string {
  return registeringExtension.replace('fixture-provider', providerId)
}
