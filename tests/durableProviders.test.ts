import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProviderConfig } from '@earendil-works/pi-coding-agent'
import { registerExtensionProviders } from '../electron/pi/durable/providers'

/**
 * Cutover gate item 9, consequence two: a user whose model comes from an extension (the SDK's own
 * comment names `copilot-provider.ts` registering `github-copilot`) starts a durable session and is
 * told "no model has credentials", because the durable runtime loads no extensions at all.
 *
 * Only GLOBAL extensions (`~/.pi/agent/extensions`) are loaded here, matching the shipped SDK path:
 * those are the user's own code and load regardless of workspace trust, while project-local
 * extensions stay out so a provider from one workspace cannot leak into another session through the
 * process-wide model runtime.
 */

const dirs: string[] = []

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

/** A global extension dir whose one extension registers a provider. */
async function agentWithProvider(extensionSource: string): Promise<string> {
  const agentDir = await mkdtemp(join(tmpdir(), 'openpi-providers-'))
  dirs.push(agentDir)
  await mkdir(join(agentDir, 'extensions'), { recursive: true })
  await writeFile(join(agentDir, 'extensions', 'fixture.ts'), extensionSource)
  return agentDir
}

const registeringExtension = `
export default function (pi) {
  pi.registerProvider('fixture-provider', {
    baseUrl: 'https://example.invalid/v1',
    apiKey: 'fixture-key',
    api: 'openai-completions',
    models: [{ id: 'fixture-model', name: 'Fixture' }],
  })
}
`

function fakeRuntime() {
  const registered: Array<{ providerId: string; config: ProviderConfig }> = []
  return {
    registered,
    registerProvider: vi.fn((providerId: string, config: ProviderConfig) => {
      registered.push({ providerId, config })
    }),
  }
}

describe('extension-provided model providers on the durable path (#37 item 9)', () => {
  it('registers a provider declared by a global extension', async () => {
    const agentDir = await agentWithProvider(registeringExtension)
    const models = fakeRuntime()

    const diagnostics = await registerExtensionProviders({ agentDir, models })

    expect(models.registered.map((entry) => entry.providerId)).toEqual(['fixture-provider'])
    expect(diagnostics).toEqual([])
  })

  it('reports an extension that fails to load, instead of failing the session', async () => {
    const agentDir = await agentWithProvider('throw new Error("boom")\n')
    const models = fakeRuntime()

    const diagnostics = await registerExtensionProviders({ agentDir, models })

    expect(models.registered).toEqual([])
    expect(diagnostics.some((entry) => entry.type === 'error' || entry.type === 'warning')).toBe(
      true
    )
  })

  it('reports a rejected provider registration and still registers the others', async () => {
    // Two extensions: the first registers a name the runtime refuses, the second is fine. A bad
    // extension must not cost the user the good one.
    const agentDir = await mkdtemp(join(tmpdir(), 'openpi-providers-'))
    dirs.push(agentDir)
    await mkdir(join(agentDir, 'extensions'), { recursive: true })
    await writeFile(join(agentDir, 'extensions', 'a-bad.ts'), registeringExtension)
    await writeFile(
      join(agentDir, 'extensions', 'b-good.ts'),
      registeringExtension.replace('fixture-provider', 'other-provider')
    )

    const models = {
      registerProvider: vi.fn((providerId: string) => {
        if (providerId === 'fixture-provider') throw new Error('rejected')
      }),
    }

    const diagnostics = await registerExtensionProviders({ agentDir, models })

    expect(models.registerProvider).toHaveBeenCalledTimes(2)
    expect(diagnostics.some((entry) => entry.message.includes('rejected'))).toBe(true)
  })

  it('does not register the same provider twice across calls', async () => {
    // The queue lives on the runtime the loader hands out. Leaving it populated would stack a
    // duplicate registration for every later session in the process.
    const agentDir = await agentWithProvider(registeringExtension)
    const models = fakeRuntime()

    await registerExtensionProviders({ agentDir, models })
    const second = await registerExtensionProviders({ agentDir, models })

    expect(models.registered.map((entry) => entry.providerId)).toEqual([
      'fixture-provider',
      'fixture-provider',
    ])
    expect(second).toEqual([])
  })

  it('stays quiet when the user has never installed an extension', async () => {
    // The loader falls back to importing `agentDir` itself when it holds no `extensions/`, which
    // reported "Cannot find module <agentDir>" on every start for a user with no extensions.
    const agentDir = await mkdtemp(join(tmpdir(), 'openpi-providers-'))
    dirs.push(agentDir)
    const models = fakeRuntime()

    const diagnostics = await registerExtensionProviders({ agentDir, models })

    expect(models.registerProvider).not.toHaveBeenCalled()
    expect(diagnostics).toEqual([])
  })

  it('ignores project-local extensions, so one workspace cannot supply providers to another', async () => {
    // A global extension registers one provider; the workspace's own `.pi/extensions` registers
    // another. Only the global one may appear: the model runtime is process-wide, so a provider from
    // one workspace would otherwise serve every later session, untrusted ones included.
    const agentDir = await agentWithProvider(registeringExtension)
    const workspace = await mkdtemp(join(tmpdir(), 'openpi-ws-'))
    dirs.push(workspace)
    await mkdir(join(workspace, '.pi', 'extensions'), { recursive: true })
    await writeFile(
      join(workspace, '.pi', 'extensions', 'local.ts'),
      registeringExtension.replace('fixture-provider', 'workspace-only-provider')
    )

    const models = fakeRuntime()

    const diagnostics = await registerExtensionProviders({ agentDir, models, cwd: workspace })

    expect(models.registered.map((entry) => entry.providerId)).toEqual(['fixture-provider'])
    expect(diagnostics).toEqual([])
  })
})
