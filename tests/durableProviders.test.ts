import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerExtensionProviders } from '../electron/pi/durable/providers'
import {
  agentWithProvider,
  dirs,
  fakeRuntime,
  registeringExtension,
  registeringExtensionFor,
  rmAll,
  withSettingsExtension,
} from './helpers/durableProviders'

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

afterEach(rmAll)

describe('extension-provided model providers on the durable path (#37 item 9)', () => {
  it('reports an extension that fails to load, instead of failing the session', async () => {
    const agentDir = await agentWithProvider('throw new Error("boom")\n')
    const models = fakeRuntime()

    const diagnostics = await registerExtensionProviders({ agentDir, models })

    expect(models.registered).toEqual([])
    // The format matches the shipped path, so a failure reads the same on both runtimes.
    expect(diagnostics.map((entry) => entry.type)).toEqual(['error'])
    expect(diagnostics[0]?.message).toMatch(/^\[extension\] .+ \(load\): /)
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
      registerNativeProvider: vi.fn(),
      refresh: vi.fn(async () => ({})),
      hasConfiguredAuth: vi.fn(() => true),
    }

    const diagnostics = await registerExtensionProviders({ agentDir, models })

    expect(models.registerProvider).toHaveBeenCalledTimes(2)
    expect(diagnostics.some((entry) => entry.message.includes('rejected'))).toBe(true)
  })

  it('registers the provider once per call, with no stale queue carried over', async () => {
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

  it('registers a provider declared by a global extension', async () => {
    const agentDir = await agentWithProvider(registeringExtension)
    const models = fakeRuntime()

    const diagnostics = await registerExtensionProviders({ agentDir, models })

    expect(models.registered.map((entry) => entry.providerId)).toEqual(['fixture-provider'])
    expect(diagnostics).toEqual([])
  })

  it('registers providers named by the global settings.json, not just the extensions dir', async () => {
    // These are the same trust level as `extensions/` — the user's own global config — and a `pi
    // install`ed provider package lands here, which is how most extension providers actually ship.
    const agentDir = await agentWithProvider(registeringExtension)
    await withSettingsExtension(agentDir, 'settings-provider')
    const models = fakeRuntime()

    const diagnostics = await registerExtensionProviders({ agentDir, models })

    expect(models.registered.map((entry) => entry.providerId).sort()).toEqual([
      'fixture-provider',
      'settings-provider',
    ])
    expect(diagnostics).toEqual([])
  })

  it('registers a provider handed over in the native provider form', async () => {
    // `pi.registerProvider(providerObject)` queues a native provider instead of a config; the
    // durable path dropped those silently before.
    const agentDir = await agentWithProvider(`
export default function (pi) {
  pi.registerProvider({
    id: 'native-provider',
    name: 'Native',
    auth: { apiKey: { name: 'Native', getKey: () => 'k' } },
    getModels: () => [],
    stream: () => { throw new Error('not used') },
    streamSimple: () => { throw new Error('not used') },
  })
}
`)
    const models = fakeRuntime()

    const diagnostics = await registerExtensionProviders({ agentDir, models })

    expect(models.native).toEqual(['native-provider'])
    expect(diagnostics).toEqual([])
  })

  it('keeps the working native provider when another one is rejected', async () => {
    // Two extensions queue native providers; the first is refused by the runtime.
    const agentDir = await mkdtemp(join(tmpdir(), 'openpi-providers-'))
    dirs.push(agentDir)
    await mkdir(join(agentDir, 'extensions'), { recursive: true })
    const nativeSource = (id: string) => `
export default function (pi) {
  pi.registerProvider({
    id: '${id}', name: '${id}',
    auth: { apiKey: { name: 'k', getKey: () => 'k' } },
    getModels: () => [], stream: () => { throw new Error('unused') },
    streamSimple: () => { throw new Error('unused') },
  })
}
`
    await writeFile(join(agentDir, 'extensions', 'a.ts'), nativeSource('bad-native'))
    await writeFile(join(agentDir, 'extensions', 'b.ts'), nativeSource('good-native'))

    const native: string[] = []
    const models = {
      registerProvider: vi.fn(),
      registerNativeProvider: vi.fn((provider: { id: string }) => {
        if (provider.id === 'bad-native') throw new Error('refused')
        native.push(provider.id)
      }),
      refresh: vi.fn(async () => ({})),
      hasConfiguredAuth: vi.fn(() => true),
    }

    const diagnostics = await registerExtensionProviders({ agentDir, models })

    expect(native).toEqual(['good-native'])
    expect(diagnostics.map((entry) => entry.message).join()).toContain('refused')
  })

  it('reports a virtual model as unsupported rather than registering one that would throw', async () => {
    // A virtual model's `route` needs a bound runner context; the durable path never binds one, so
    // registering it would look fine and then throw on the first request.
    const agentDir = await agentWithProvider(`
export default function (pi) {
  pi.registerVirtualModel({ id: 'virt', provider: 'virt', name: 'Virtual', route: () => [] })
}
`)
    const models = fakeRuntime()

    const diagnostics = await registerExtensionProviders({ agentDir, models })

    expect(models.registered).toEqual([])
    expect(diagnostics.map((entry) => entry.type)).toEqual(['warning'])
    expect(diagnostics[0]?.message).toContain('virtual')
  })

  it('still loads a provider that ships as an installed package, with no extensions dir', async () => {
    // `pi install` puts packages under `<agentDir>/npm`, not `extensions/`. An earlier version
    // returned early when `extensions/` was absent, silently skipping exactly this case.
    const agentDir = await mkdtemp(join(tmpdir(), 'openpi-providers-'))
    dirs.push(agentDir)
    const pkgDir = join(agentDir, 'npm', 'node_modules', 'npm-provider')
    await mkdir(pkgDir, { recursive: true })
    await writeFile(join(pkgDir, 'index.js'), registeringExtensionFor('npm-provider'))
    // Both fields are load-bearing: without `pi.extensions` the package contributes nothing (a root
    // `index.js` is not auto-discovered), and without `version` the npm spec does not resolve.
    await writeFile(
      join(pkgDir, 'package.json'),
      JSON.stringify({
        name: 'npm-provider',
        type: 'module',
        version: '1.0.0',
        pi: { extensions: ['./index.js'] },
      })
    )
    await writeFile(
      join(agentDir, 'settings.json'),
      JSON.stringify({ packages: ['npm:npm-provider'] })
    )
    // Keeps the loader off `npm install`: offline mode skips a missing package silently, which is
    // exactly the failure this test must not mask.
    const previousOffline = process.env.PI_OFFLINE
    process.env.PI_OFFLINE = '1'
    const models = fakeRuntime()

    const diagnostics = await registerExtensionProviders({ agentDir, models })
    if (previousOffline === undefined) delete process.env.PI_OFFLINE
    else process.env.PI_OFFLINE = previousOffline

    expect(models.registered.map((entry) => entry.providerId)).toEqual(['npm-provider'])
    expect(diagnostics).toEqual([])
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
